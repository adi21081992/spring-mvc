/**
 * Copyright 2017 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
import { FieldPath as ExternalFieldPath } from './field_path';
import { DatabaseId, DatabaseInfo } from '../core/database_info';
import { FirestoreClient } from '../core/firestore_client';
import { Bound, Direction, fieldFilter, OrderBy, Query as InternalQuery, RelationFilter, RelationOp } from '../core/query';
import { ChangeType } from '../core/view_snapshot';
import { NoDocument } from '../model/document';
import { DocumentKey } from '../model/document_key';
import { ArrayValue, ObjectValue, RefValue } from '../model/field_value';
import { DeleteMutation, Precondition } from '../model/mutation';
import { ResourcePath } from '../model/path';
import { PlatformSupport } from '../platform/platform';
import { makeConstructorPrivate } from '../util/api';
import { assert, fail } from '../util/assert';
import { AsyncObserver } from '../util/async_observer';
import { AsyncQueue } from '../util/async_queue';
import { Code, FirestoreError } from '../util/error';
import { invalidClassError, validateArgType, validateAtLeastNumberOfArgs, validateBetweenNumberOfArgs, validateDefined, validateExactNumberOfArgs, validateNamedOptionalType, validateNamedType, validateOptionalArgType, validateOptionNames, valueDescription } from '../util/input_validation';
import * as log from '../util/log';
import { LogLevel } from '../util/log';
import { AutoId } from '../util/misc';
import * as objUtils from '../util/obj';
import { EmptyCredentialsProvider, FirebaseCredentialsProvider, makeCredentialsProvider } from './credentials';
import { isPartialObserver } from './observer';
import { DocumentKeyReference, fieldPathFromArgument, UserDataConverter } from './user_data_converter';
// The objects that are a part of this API are exposed to third-parties as
// compiled javascript so we want to flag our private members with a leading
// underscore to discourage their use.
// tslint:disable:strip-private-property-underscore
var DEFAULT_HOST = 'firestore.googleapis.com';
var DEFAULT_SSL = true;
/**
 * A concrete type describing all the values that can be applied via a
 * user-supplied firestore.Settings object. This is a separate type so that
 * defaults can be supplied and the value can be checked for equality.
 */
var FirestoreSettings = /** @class */ (function () {
    function FirestoreSettings(settings) {
        if (settings.host === undefined) {
            if (settings.ssl !== undefined) {
                throw new FirestoreError(Code.INVALID_ARGUMENT, "Can't provide ssl option if host option is not set");
            }
            this.host = DEFAULT_HOST;
            this.ssl = DEFAULT_SSL;
        }
        else {
            validateNamedType('settings', 'string', 'host', settings.host);
            this.host = settings.host;
            validateNamedOptionalType('settings', 'boolean', 'ssl', settings.ssl);
            this.ssl = objUtils.defaulted(settings.ssl, DEFAULT_SSL);
        }
        validateOptionNames('settings', settings, ['host', 'ssl', 'credentials']);
        validateNamedOptionalType('settings', 'object', 'credentials', settings.credentials);
        this.credentials = settings.credentials;
    }
    FirestoreSettings.prototype.equals = function (other) {
        return (this.host === other.host &&
            this.ssl === other.ssl &&
            this.credentials === other.credentials);
    };
    return FirestoreSettings;
}());
var FirestoreConfig = /** @class */ (function () {
    function FirestoreConfig() {
    }
    return FirestoreConfig;
}());
/**
 * The root reference to the database.
 */
var Firestore = /** @class */ (function () {
    function Firestore(databaseIdOrApp) {
        var _this = this;
        this.INTERNAL = {
            delete: function () {
                if (_this._firestoreClient) {
                    return _this._firestoreClient.shutdown();
                }
                else {
                    return Promise.resolve();
                }
            },
            // Exposed via INTERNAL for use in tests.
            disableNetwork: function () { return _this._firestoreClient.disableNetwork(); },
            enableNetwork: function () { return _this._firestoreClient.enableNetwork(); }
        };
        var config = new FirestoreConfig();
        if (typeof databaseIdOrApp.options === 'object') {
            // This is very likely a Firebase app object
            // TODO(b/34177605): Can we somehow use instanceof?
            var app = databaseIdOrApp;
            config.firebaseApp = app;
            config.databaseId = Firestore.databaseIdFromApp(app);
            config.persistenceKey = config.firebaseApp.name;
            config.credentials = new FirebaseCredentialsProvider(app);
        }
        else {
            var external_1 = databaseIdOrApp;
            if (!external_1.projectId) {
                throw new FirestoreError(Code.INVALID_ARGUMENT, 'Must provide projectId');
            }
            config.databaseId = new DatabaseId(external_1.projectId, external_1.database);
            // Use a default persistenceKey that lines up with FirebaseApp.
            config.persistenceKey = '[DEFAULT]';
            config.credentials = new EmptyCredentialsProvider();
        }
        config.settings = new FirestoreSettings({});
        this._config = config;
        this._databaseId = config.databaseId;
    }
    Firestore.prototype.settings = function (settingsLiteral) {
        validateExactNumberOfArgs('Firestore.settings', arguments, 1);
        validateArgType('Firestore.settings', 'object', 1, settingsLiteral);
        if (objUtils.contains(settingsLiteral, 'persistence')) {
            throw new FirestoreError(Code.INVALID_ARGUMENT, '"persistence" is now specified with a separate call to ' +
                'firestore.enablePersistence().');
        }
        var newSettings = new FirestoreSettings(settingsLiteral);
        if (this._firestoreClient && !this._config.settings.equals(newSettings)) {
            throw new FirestoreError(Code.FAILED_PRECONDITION, 'Firestore has already been started and its settings can no longer ' +
                'be changed. You can only call settings() before calling any other ' +
                'methods on a Firestore object.');
        }
        this._config.settings = newSettings;
        if (newSettings.credentials !== undefined) {
            this._config.credentials = makeCredentialsProvider(newSettings.credentials);
        }
    };
    Firestore.prototype.enablePersistence = function () {
        if (this._firestoreClient) {
            throw new FirestoreError(Code.FAILED_PRECONDITION, 'Firestore has already been started and persistence can no longer ' +
                'be enabled. You can only call enablePersistence() before calling ' +
                'any other methods on a Firestore object.');
        }
        return this.configureClient(/* persistence= */ true);
    };
    Firestore.prototype.ensureClientConfigured = function () {
        if (!this._firestoreClient) {
            this.configureClient(/* persistence= */ false);
        }
        return this._firestoreClient;
    };
    Firestore.prototype.configureClient = function (persistence) {
        var _this = this;
        assert(!!this._config.settings.host, 'FirestoreSettings.host cannot be falsey');
        assert(!this._firestoreClient, 'configureClient() called multiple times');
        var databaseInfo = new DatabaseInfo(this._config.databaseId, this._config.persistenceKey, this._config.settings.host, this._config.settings.ssl);
        var preConverter = function (value) {
            if (value instanceof DocumentReference) {
                var thisDb = _this._config.databaseId;
                var otherDb = value.firestore._config.databaseId;
                if (!otherDb.equals(thisDb)) {
                    throw new FirestoreError(Code.INVALID_ARGUMENT, 'Document reference is for database ' +
                        (otherDb.projectId + "/" + otherDb.database + " but should be ") +
                        ("for database " + thisDb.projectId + "/" + thisDb.database));
                }
                return new DocumentKeyReference(_this._config.databaseId, value._key);
            }
            else {
                return value;
            }
        };
        this._dataConverter = new UserDataConverter(preConverter);
        this._firestoreClient = new FirestoreClient(PlatformSupport.getPlatform(), databaseInfo, this._config.credentials, new AsyncQueue());
        return this._firestoreClient.start(persistence);
    };
    Firestore.databaseIdFromApp = function (app) {
        var options = app.options;
        if (!objUtils.contains(options, 'projectId')) {
            // TODO(b/62673263): We can safely remove the special handling of
            // 'firestoreId' once alpha testers have upgraded.
            if (objUtils.contains(options, 'firestoreId')) {
                throw new FirestoreError(Code.INVALID_ARGUMENT, '"firestoreId" is now specified as "projectId" in ' +
                    'firebase.initializeApp.');
            }
            throw new FirestoreError(Code.INVALID_ARGUMENT, '"projectId" not provided in firebase.initializeApp.');
        }
        if (objUtils.contains(options, 'firestoreOptions')) {
            // TODO(b/62673263): We can safely remove the special handling of
            // 'firestoreOptions' once alpha testers have upgraded.
            throw new FirestoreError(Code.INVALID_ARGUMENT, '"firestoreOptions" values are now specified with ' +
                'Firestore.settings()');
        }
        var projectId = options['projectId'];
        if (!projectId || typeof projectId !== 'string') {
            throw new FirestoreError(Code.INVALID_ARGUMENT, 'projectId must be a string in FirebaseApp.options');
        }
        return new DatabaseId(projectId);
    };
    Object.defineProperty(Firestore.prototype, "app", {
        get: function () {
            if (!this._config.firebaseApp) {
                throw new FirestoreError(Code.FAILED_PRECONDITION, "Firestore was not initialized using the Firebase SDK. 'app' is " +
                    'not available');
            }
            return this._config.firebaseApp;
        },
        enumerable: true,
        configurable: true
    });
    Firestore.prototype.collection = function (pathString) {
        validateExactNumberOfArgs('Firestore.collection', arguments, 1);
        validateArgType('Firestore.collection', 'string', 1, pathString);
        if (!pathString) {
            throw new FirestoreError(Code.INVALID_ARGUMENT, 'Must provide a non-empty collection path to collection()');
        }
        this.ensureClientConfigured();
        return new CollectionReference(ResourcePath.fromString(pathString), this);
    };
    Firestore.prototype.doc = function (pathString) {
        validateExactNumberOfArgs('Firestore.doc', arguments, 1);
        validateArgType('Firestore.doc', 'string', 1, pathString);
        if (!pathString) {
            throw new FirestoreError(Code.INVALID_ARGUMENT, 'Must provide a non-empty document path to doc()');
        }
        this.ensureClientConfigured();
        return DocumentReference.forPath(ResourcePath.fromString(pathString), this);
    };
    Firestore.prototype.runTransaction = function (updateFunction) {
        var _this = this;
        validateExactNumberOfArgs('Firestore.runTransaction', arguments, 1);
        validateArgType('Firestore.runTransaction', 'function', 1, updateFunction);
        return this.ensureClientConfigured().transaction(function (transaction) {
            return updateFunction(new Transaction(_this, transaction));
        });
    };
    Firestore.prototype.batch = function () {
        this.ensureClientConfigured();
        return new WriteBatch(this);
    };
    Object.defineProperty(Firestore, "logLevel", {
        get: function () {
            switch (log.getLogLevel()) {
                case LogLevel.DEBUG:
                    return 'debug';
                case LogLevel.ERROR:
                    return 'error';
                case LogLevel.SILENT:
                    return 'silent';
                default:
                    return fail('Unknown log level: ' + log.getLogLevel());
            }
        },
        enumerable: true,
        configurable: true
    });
    Firestore.setLogLevel = function (level) {
        validateExactNumberOfArgs('Firestore.setLogLevel', arguments, 1);
        validateArgType('Firestore.setLogLevel', 'string', 1, level);
        switch (level) {
            case 'debug':
                log.setLogLevel(log.LogLevel.DEBUG);
                break;
            case 'error':
                log.setLogLevel(log.LogLevel.ERROR);
                break;
            case 'silent':
                log.setLogLevel(log.LogLevel.SILENT);
                break;
            default:
                throw new FirestoreError(Code.INVALID_ARGUMENT, 'Invalid log level: ' + level);
        }
    };
    return Firestore;
}());
export { Firestore };
/**
 * A reference to a transaction.
 */
var Transaction = /** @class */ (function () {
    function Transaction(_firestore, _transaction) {
        this._firestore = _firestore;
        this._transaction = _transaction;
    }
    Transaction.prototype.get = function (documentRef) {
        var _this = this;
        validateExactNumberOfArgs('Transaction.get', arguments, 1);
        var ref = validateReference('Transaction.get', documentRef, this._firestore);
        return this._transaction
            .lookup([ref._key])
            .then(function (docs) {
            if (!docs || docs.length !== 1) {
                return fail('Mismatch in docs returned from document lookup.');
            }
            var doc = docs[0];
            if (doc instanceof NoDocument) {
                return new DocumentSnapshot(_this._firestore, ref._key, null, false);
            }
            return new DocumentSnapshot(_this._firestore, ref._key, doc, false);
        });
    };
    Transaction.prototype.set = function (documentRef, value, options) {
        validateBetweenNumberOfArgs('Transaction.set', arguments, 2, 3);
        var ref = validateReference('Transaction.set', documentRef, this._firestore);
        options = validateSetOptions('Transaction.set', options);
        var parsed = this._firestore._dataConverter.parseSetData('Transaction.set', value, options);
        this._transaction.set(ref._key, parsed);
        return this;
    };
    Transaction.prototype.update = function (documentRef, fieldOrUpdateData, value) {
        var moreFieldsAndValues = [];
        for (var _i = 3; _i < arguments.length; _i++) {
            moreFieldsAndValues[_i - 3] = arguments[_i];
        }
        var ref;
        var parsed;
        if (typeof fieldOrUpdateData === 'string' ||
            fieldOrUpdateData instanceof ExternalFieldPath) {
            validateAtLeastNumberOfArgs('Transaction.update', arguments, 3);
            ref = validateReference('Transaction.update', documentRef, this._firestore);
            parsed = this._firestore._dataConverter.parseUpdateVarargs('Transaction.update', fieldOrUpdateData, value, moreFieldsAndValues);
        }
        else {
            validateExactNumberOfArgs('Transaction.update', arguments, 2);
            ref = validateReference('Transaction.update', documentRef, this._firestore);
            parsed = this._firestore._dataConverter.parseUpdateData('Transaction.update', fieldOrUpdateData);
        }
        this._transaction.update(ref._key, parsed);
        return this;
    };
    Transaction.prototype.delete = function (documentRef) {
        validateExactNumberOfArgs('Transaction.delete', arguments, 1);
        var ref = validateReference('Transaction.delete', documentRef, this._firestore);
        this._transaction.delete(ref._key);
        return this;
    };
    return Transaction;
}());
export { Transaction };
var WriteBatch = /** @class */ (function () {
    function WriteBatch(_firestore) {
        this._firestore = _firestore;
        this._mutations = [];
        this._committed = false;
    }
    WriteBatch.prototype.set = function (documentRef, value, options) {
        validateBetweenNumberOfArgs('WriteBatch.set', arguments, 2, 3);
        this.verifyNotCommitted();
        var ref = validateReference('WriteBatch.set', documentRef, this._firestore);
        options = validateSetOptions('WriteBatch.set', options);
        var parsed = this._firestore._dataConverter.parseSetData('WriteBatch.set', value, options);
        this._mutations = this._mutations.concat(parsed.toMutations(ref._key, Precondition.NONE));
        return this;
    };
    WriteBatch.prototype.update = function (documentRef, fieldOrUpdateData, value) {
        var moreFieldsAndValues = [];
        for (var _i = 3; _i < arguments.length; _i++) {
            moreFieldsAndValues[_i - 3] = arguments[_i];
        }
        this.verifyNotCommitted();
        var ref;
        var parsed;
        if (typeof fieldOrUpdateData === 'string' ||
            fieldOrUpdateData instanceof ExternalFieldPath) {
            validateAtLeastNumberOfArgs('WriteBatch.update', arguments, 3);
            ref = validateReference('WriteBatch.update', documentRef, this._firestore);
            parsed = this._firestore._dataConverter.parseUpdateVarargs('WriteBatch.update', fieldOrUpdateData, value, moreFieldsAndValues);
        }
        else {
            validateExactNumberOfArgs('WriteBatch.update', arguments, 2);
            ref = validateReference('WriteBatch.update', documentRef, this._firestore);
            parsed = this._firestore._dataConverter.parseUpdateData('WriteBatch.update', fieldOrUpdateData);
        }
        this._mutations = this._mutations.concat(parsed.toMutations(ref._key, Precondition.exists(true)));
        return this;
    };
    WriteBatch.prototype.delete = function (documentRef) {
        validateExactNumberOfArgs('WriteBatch.delete', arguments, 1);
        this.verifyNotCommitted();
        var ref = validateReference('WriteBatch.delete', documentRef, this._firestore);
        this._mutations = this._mutations.concat(new DeleteMutation(ref._key, Precondition.NONE));
        return this;
    };
    WriteBatch.prototype.commit = function () {
        this.verifyNotCommitted();
        this._committed = true;
        if (this._mutations.length > 0) {
            return this._firestore.ensureClientConfigured().write(this._mutations);
        }
        else {
            return Promise.resolve();
        }
    };
    WriteBatch.prototype.verifyNotCommitted = function () {
        if (this._committed) {
            throw new FirestoreError(Code.FAILED_PRECONDITION, 'A write batch can no longer be used after commit() ' +
                'has been called.');
        }
    };
    return WriteBatch;
}());
export { WriteBatch };
/**
 * A reference to a particular document in a collection in the database.
 */
var DocumentReference = /** @class */ (function () {
    function DocumentReference(_key, firestore) {
        this._key = _key;
        this.firestore = firestore;
        this._firestoreClient = this.firestore.ensureClientConfigured();
    }
    DocumentReference.forPath = function (path, firestore) {
        if (path.length % 2 !== 0) {
            throw new FirestoreError(Code.INVALID_ARGUMENT, 'Invalid document reference. Document ' +
                'references must have an even number of segments, but ' +
                (path.canonicalString() + " has " + path.length));
        }
        return new DocumentReference(new DocumentKey(path), firestore);
    };
    Object.defineProperty(DocumentReference.prototype, "id", {
        get: function () {
            return this._key.path.lastSegment();
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(DocumentReference.prototype, "parent", {
        get: function () {
            return new CollectionReference(this._key.path.popLast(), this.firestore);
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(DocumentReference.prototype, "path", {
        get: function () {
            return this._key.path.canonicalString();
        },
        enumerable: true,
        configurable: true
    });
    DocumentReference.prototype.collection = function (pathString) {
        validateExactNumberOfArgs('DocumentReference.collection', arguments, 1);
        validateArgType('DocumentReference.collection', 'string', 1, pathString);
        if (!pathString) {
            throw new FirestoreError(Code.INVALID_ARGUMENT, 'Must provide a non-empty collection name to collection()');
        }
        var path = ResourcePath.fromString(pathString);
        return new CollectionReference(this._key.path.child(path), this.firestore);
    };
    DocumentReference.prototype.set = function (value, options) {
        validateBetweenNumberOfArgs('DocumentReference.set', arguments, 1, 2);
        options = validateSetOptions('DocumentReference.set', options);
        var parsed = this.firestore._dataConverter.parseSetData('DocumentReference.set', value, options);
        return this._firestoreClient.write(parsed.toMutations(this._key, Precondition.NONE));
    };
    DocumentReference.prototype.update = function (fieldOrUpdateData, value) {
        var moreFieldsAndValues = [];
        for (var _i = 2; _i < arguments.length; _i++) {
            moreFieldsAndValues[_i - 2] = arguments[_i];
        }
        var parsed;
        if (typeof fieldOrUpdateData === 'string' ||
            fieldOrUpdateData instanceof ExternalFieldPath) {
            validateAtLeastNumberOfArgs('DocumentReference.update', arguments, 2);
            parsed = this.firestore._dataConverter.parseUpdateVarargs('DocumentReference.update', fieldOrUpdateData, value, moreFieldsAndValues);
        }
        else {
            validateExactNumberOfArgs('DocumentReference.update', arguments, 1);
            parsed = this.firestore._dataConverter.parseUpdateData('DocumentReference.update', fieldOrUpdateData);
        }
        return this._firestoreClient.write(parsed.toMutations(this._key, Precondition.exists(true)));
    };
    DocumentReference.prototype.delete = function () {
        validateExactNumberOfArgs('DocumentReference.delete', arguments, 0);
        return this._firestoreClient.write([
            new DeleteMutation(this._key, Precondition.NONE)
        ]);
    };
    DocumentReference.prototype.onSnapshot = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        validateBetweenNumberOfArgs('DocumentReference.onSnapshot', arguments, 1, 4);
        var options = {
            includeMetadataChanges: false
        };
        var observer;
        var currArg = 0;
        if (typeof args[currArg] === 'object' &&
            !isPartialObserver(args[currArg])) {
            options = args[currArg];
            validateOptionNames('DocumentReference.onSnapshot', options, [
                'includeMetadataChanges'
            ]);
            validateNamedOptionalType('DocumentReference.onSnapshot', 'boolean', 'includeMetadataChanges', options.includeMetadataChanges);
            currArg++;
        }
        var internalOptions = {
            includeDocumentMetadataChanges: options.includeMetadataChanges,
            includeQueryMetadataChanges: options.includeMetadataChanges
        };
        if (isPartialObserver(args[currArg])) {
            observer = args[currArg];
        }
        else {
            validateArgType('DocumentReference.onSnapshot', 'function', currArg, args[currArg]);
            validateOptionalArgType('DocumentReference.onSnapshot', 'function', currArg + 1, args[currArg + 1]);
            validateOptionalArgType('DocumentReference.onSnapshot', 'function', currArg + 2, args[currArg + 2]);
            observer = {
                next: args[currArg],
                error: args[currArg + 1],
                complete: args[currArg + 2]
            };
        }
        return this.onSnapshotInternal(internalOptions, observer);
    };
    DocumentReference.prototype.onSnapshotInternal = function (options, observer) {
        var _this = this;
        var errHandler = function (err) {
            console.error('Uncaught Error in onSnapshot:', err);
        };
        if (observer.error) {
            errHandler = observer.error.bind(observer);
        }
        var asyncObserver = new AsyncObserver({
            next: function (snapshot) {
                if (observer.next) {
                    assert(snapshot.docs.size <= 1, 'Too many documents returned on a document query');
                    var doc = snapshot.docs.get(_this._key);
                    observer.next(new DocumentSnapshot(_this.firestore, _this._key, doc, snapshot.fromCache));
                }
            },
            error: errHandler
        });
        var internalListener = this._firestoreClient.listen(InternalQuery.atPath(this._key.path), asyncObserver, options);
        return function () {
            asyncObserver.mute();
            _this._firestoreClient.unlisten(internalListener);
        };
    };
    DocumentReference.prototype.get = function () {
        var _this = this;
        validateExactNumberOfArgs('DocumentReference.get', arguments, 0);
        return new Promise(function (resolve, reject) {
            var unlisten = _this.onSnapshotInternal({
                includeQueryMetadataChanges: true,
                includeDocumentMetadataChanges: true,
                waitForSyncWhenOnline: true
            }, {
                next: function (snap) {
                    // Remove query first before passing event to user to avoid
                    // user actions affecting the now stale query.
                    unlisten();
                    if (!snap.exists && snap.metadata.fromCache) {
                        // TODO(dimond): If we're online and the document doesn't
                        // exist then we resolve with a doc.exists set to false. If
                        // we're offline however, we reject the Promise in this
                        // case. Two options: 1) Cache the negative response from
                        // the server so we can deliver that even when you're
                        // offline 2) Actually reject the Promise in the online case
                        // if the document doesn't exist.
                        reject(new FirestoreError(Code.ABORTED, 'Failed to get document because the client is ' + 'offline.'));
                    }
                    else {
                        resolve(snap);
                    }
                },
                error: reject
            });
        });
    };
    return DocumentReference;
}());
export { DocumentReference };
var DocumentSnapshot = /** @class */ (function () {
    function DocumentSnapshot(_firestore, _key, _document, _fromCache) {
        this._firestore = _firestore;
        this._key = _key;
        this._document = _document;
        this._fromCache = _fromCache;
    }
    DocumentSnapshot.prototype.data = function () {
        validateExactNumberOfArgs('DocumentSnapshot.data', arguments, 0);
        if (!this._document) {
            throw new FirestoreError(Code.NOT_FOUND, "This document doesn't exist. Check doc.exists to make sure " +
                'the document exists before calling doc.data().');
        }
        return this.convertObject(this._document.data);
    };
    DocumentSnapshot.prototype.get = function (fieldPath) {
        validateExactNumberOfArgs('DocumentSnapshot.get', arguments, 1);
        if (!this._document) {
            throw new FirestoreError(Code.NOT_FOUND, "This document doesn't exist. Check doc.exists to make sure " +
                'the document exists before calling doc.get().');
        }
        var value = this._document.data.field(fieldPathFromArgument('DocumentSnapshot.get', fieldPath));
        return value === undefined ? undefined : this.convertValue(value);
    };
    Object.defineProperty(DocumentSnapshot.prototype, "id", {
        get: function () {
            return this._key.path.lastSegment();
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(DocumentSnapshot.prototype, "ref", {
        get: function () {
            return new DocumentReference(this._key, this._firestore);
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(DocumentSnapshot.prototype, "exists", {
        get: function () {
            return this._document !== null;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(DocumentSnapshot.prototype, "metadata", {
        get: function () {
            return {
                hasPendingWrites: this._document !== null && this._document.hasLocalMutations,
                fromCache: this._fromCache
            };
        },
        enumerable: true,
        configurable: true
    });
    DocumentSnapshot.prototype.convertObject = function (data) {
        var _this = this;
        var result = {};
        data.forEach(function (key, value) {
            result[key] = _this.convertValue(value);
        });
        return result;
    };
    DocumentSnapshot.prototype.convertValue = function (value) {
        if (value instanceof ObjectValue) {
            return this.convertObject(value);
        }
        else if (value instanceof ArrayValue) {
            return this.convertArray(value);
        }
        else if (value instanceof RefValue) {
            var key = value.value();
            var database = this._firestore.ensureClientConfigured().databaseId();
            if (!value.databaseId.equals(database)) {
                // TODO(b/64130202): Somehow support foreign references.
                log.error("Document " + this._key.path + " contains a document " +
                    "reference within a different database (" +
                    (value.databaseId.projectId + "/" + value.databaseId
                        .database + ") which is not ") +
                    "supported. It will be treated as a reference in the current " +
                    ("database (" + database.projectId + "/" + database.database + ") ") +
                    "instead.");
            }
            return new DocumentReference(key, this._firestore);
        }
        else {
            return value.value();
        }
    };
    DocumentSnapshot.prototype.convertArray = function (data) {
        var _this = this;
        return data.internalValue.map(function (value) {
            return _this.convertValue(value);
        });
    };
    return DocumentSnapshot;
}());
export { DocumentSnapshot };
var Query = /** @class */ (function () {
    function Query(_query, firestore) {
        this._query = _query;
        this.firestore = firestore;
    }
    Query.prototype.where = function (field, opStr, value) {
        validateExactNumberOfArgs('Query.where', arguments, 3);
        validateArgType('Query.where', 'string', 2, opStr);
        validateDefined('Query.where', 3, value);
        var fieldValue;
        var fieldPath = fieldPathFromArgument('Query.where', field);
        if (fieldPath.isKeyField()) {
            if (typeof value === 'string') {
                if (value.indexOf('/') !== -1) {
                    // TODO(dimond): Allow slashes once ancestor queries are supported
                    throw new FirestoreError(Code.INVALID_ARGUMENT, 'Function Query.where() requires its third parameter to be a ' +
                        'valid document ID if the first parameter is ' +
                        'FieldPath.documentId(), but it contains a slash.');
                }
                if (value === '') {
                    throw new FirestoreError(Code.INVALID_ARGUMENT, 'Function Query.where() requires its third parameter to be a ' +
                        'valid document ID if the first parameter is ' +
                        'FieldPath.documentId(), but it was an empty string.');
                }
                var path = this._query.path.child(new ResourcePath([value]));
                assert(path.length % 2 === 0, 'Path should be a document key');
                fieldValue = new RefValue(this.firestore._databaseId, new DocumentKey(path));
            }
            else if (value instanceof DocumentReference) {
                var ref = value;
                fieldValue = new RefValue(this.firestore._databaseId, ref._key);
            }
            else {
                throw new FirestoreError(Code.INVALID_ARGUMENT, "Function Query.where() requires its third parameter to be a " +
                    "string or a DocumentReference if the first parameter is " +
                    "FieldPath.documentId(), but it was: " +
                    (valueDescription(value) + "."));
            }
        }
        else {
            fieldValue = this.firestore._dataConverter.parseQueryValue('Query.where', value);
        }
        var filter = fieldFilter(fieldPath, RelationOp.fromString(opStr), fieldValue);
        this.validateNewFilter(filter);
        return new Query(this._query.addFilter(filter), this.firestore);
    };
    Query.prototype.orderBy = function (field, directionStr) {
        validateBetweenNumberOfArgs('Query.orderBy', arguments, 1, 2);
        validateOptionalArgType('Query.orderBy', 'string', 2, directionStr);
        var direction;
        if (directionStr === undefined || directionStr === 'asc') {
            direction = Direction.ASCENDING;
        }
        else if (directionStr === 'desc') {
            direction = Direction.DESCENDING;
        }
        else {
            throw new FirestoreError(Code.INVALID_ARGUMENT, "Function Query.orderBy() has unknown direction '" + directionStr + "', " +
                "expected 'asc' or 'desc'.");
        }
        if (this._query.startAt !== null) {
            throw new FirestoreError(Code.INVALID_ARGUMENT, 'Invalid query. You must not call Query.startAt() or ' +
                'Query.startAfter() before calling Query.orderBy().');
        }
        if (this._query.endAt !== null) {
            throw new FirestoreError(Code.INVALID_ARGUMENT, 'Invalid query. You must not call Query.endAt() or ' +
                'Query.endBefore() before calling Query.orderBy().');
        }
        var fieldPath = fieldPathFromArgument('Query.orderBy', field);
        var orderBy = new OrderBy(fieldPath, direction);
        this.validateNewOrderBy(orderBy);
        return new Query(this._query.addOrderBy(orderBy), this.firestore);
    };
    Query.prototype.limit = function (n) {
        validateExactNumberOfArgs('Query.limit', arguments, 1);
        validateArgType('Query.limit', 'number', 1, n);
        if (n <= 0) {
            throw new FirestoreError(Code.INVALID_ARGUMENT, "Invalid Query. Query limit (" + n + ") is invalid. Limit must be " +
                'positive.');
        }
        return new Query(this._query.withLimit(n), this.firestore);
    };
    Query.prototype.startAt = function (docOrField) {
        var fields = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            fields[_i - 1] = arguments[_i];
        }
        validateAtLeastNumberOfArgs('Query.startAt', arguments, 1);
        var bound = this.boundFromDocOrFields('Query.startAt', docOrField, fields, 
        /*before=*/ true);
        return new Query(this._query.withStartAt(bound), this.firestore);
    };
    Query.prototype.startAfter = function (docOrField) {
        var fields = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            fields[_i - 1] = arguments[_i];
        }
        validateAtLeastNumberOfArgs('Query.startAfter', arguments, 1);
        var bound = this.boundFromDocOrFields('Query.startAfter', docOrField, fields, 
        /*before=*/ false);
        return new Query(this._query.withStartAt(bound), this.firestore);
    };
    Query.prototype.endBefore = function (docOrField) {
        var fields = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            fields[_i - 1] = arguments[_i];
        }
        validateAtLeastNumberOfArgs('Query.endBefore', arguments, 1);
        var bound = this.boundFromDocOrFields('Query.endBefore', docOrField, fields, 
        /*before=*/ true);
        return new Query(this._query.withEndAt(bound), this.firestore);
    };
    Query.prototype.endAt = function (docOrField) {
        var fields = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            fields[_i - 1] = arguments[_i];
        }
        validateAtLeastNumberOfArgs('Query.endAt', arguments, 1);
        var bound = this.boundFromDocOrFields('Query.endAt', docOrField, fields, 
        /*before=*/ false);
        return new Query(this._query.withEndAt(bound), this.firestore);
    };
    /** Helper function to create a bound from a document or fields */
    Query.prototype.boundFromDocOrFields = function (methodName, docOrField, fields, before) {
        validateDefined(methodName, 1, docOrField);
        if (docOrField instanceof DocumentSnapshot) {
            if (fields.length > 0) {
                throw new FirestoreError(Code.INVALID_ARGUMENT, "Too many arguments provided to " + methodName + "().");
            }
            var snap = docOrField;
            if (!snap.exists) {
                throw new FirestoreError(Code.NOT_FOUND, "Can't use a DocumentSnapshot that doesn't exist for " +
                    (methodName + "()."));
            }
            return this.boundFromDocument(methodName, snap._document, before);
        }
        else {
            var allFields = [docOrField].concat(fields);
            return this.boundFromFields(methodName, allFields, before);
        }
    };
    /**
     * Create a Bound from a query and a document.
     *
     * Note that the Bound will always include the key of the document
     * and so only the provided document will compare equal to the returned
     * position.
     *
     * Will throw if the document does not contain all fields of the order by
     * of the query.
     */
    Query.prototype.boundFromDocument = function (methodName, doc, before) {
        var components = [];
        // Because people expect to continue/end a query at the exact document
        // provided, we need to use the implicit sort order rather than the explicit
        // sort order, because it's guaranteed to contain the document key. That way
        // the position becomes unambiguous and the query continues/ends exactly at
        // the provided document. Without the key (by using the explicit sort
        // orders), multiple documents could match the position, yielding duplicate
        // results.
        for (var _i = 0, _a = this._query.orderBy; _i < _a.length; _i++) {
            var orderBy = _a[_i];
            if (orderBy.field.isKeyField()) {
                components.push(new RefValue(this.firestore._databaseId, doc.key));
            }
            else {
                var value = doc.field(orderBy.field);
                if (value !== undefined) {
                    components.push(value);
                }
                else {
                    var field = orderBy.field.canonicalString();
                    throw new FirestoreError(Code.INVALID_ARGUMENT, "Invalid query. You are trying to start or end a query using a " +
                        ("document for which the field '" + field + "' (used as the ") +
                        "orderBy) does not exist.");
                }
            }
        }
        return new Bound(components, before);
    };
    /**
     * Converts a list of field values to a Bound for the given query.
     */
    Query.prototype.boundFromFields = function (methodName, values, before) {
        // Use explicit order by's because it has to match the query the user made
        var orderBy = this._query.explicitOrderBy;
        if (values.length > orderBy.length) {
            throw new FirestoreError(Code.INVALID_ARGUMENT, "Too many arguments provided to " + methodName + "(). " +
                "The number of arguments must be less than or equal to the " +
                "number of Query.orderBy() clauses");
        }
        var components = [];
        for (var i = 0; i < values.length; i++) {
            var rawValue = values[i];
            var orderByComponent = orderBy[i];
            if (orderByComponent.field.isKeyField()) {
                if (typeof rawValue !== 'string') {
                    throw new FirestoreError(Code.INVALID_ARGUMENT, "Invalid query. Expected a string for document ID in " +
                        (methodName + "(), but got a " + typeof rawValue));
                }
                if (rawValue.indexOf('/') !== -1) {
                    throw new FirestoreError(Code.INVALID_ARGUMENT, "Invalid query. Document ID '" + rawValue + "' contains a slash in " +
                        (methodName + "()"));
                }
                var key = new DocumentKey(this._query.path.child(rawValue));
                components.push(new RefValue(this.firestore._databaseId, key));
            }
            else {
                var wrapped = this.firestore._dataConverter.parseQueryValue(methodName, rawValue);
                components.push(wrapped);
            }
        }
        return new Bound(components, before);
    };
    Query.prototype.onSnapshot = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        validateBetweenNumberOfArgs('Query.onSnapshot', arguments, 1, 4);
        var options = {};
        var observer;
        var currArg = 0;
        if (typeof args[currArg] === 'object' &&
            !isPartialObserver(args[currArg])) {
            options = args[currArg];
            validateOptionNames('Query.onSnapshot', options, [
                'includeQueryMetadataChanges',
                'includeDocumentMetadataChanges'
            ]);
            validateNamedOptionalType('Query.onSnapshot', 'boolean', 'includeDocumentMetadataChanges', options.includeDocumentMetadataChanges);
            validateNamedOptionalType('Query.onSnapshot', 'boolean', 'includeQueryMetadataChanges', options.includeQueryMetadataChanges);
            currArg++;
        }
        if (isPartialObserver(args[currArg])) {
            observer = args[currArg];
        }
        else {
            validateArgType('Query.onSnapshot', 'function', currArg, args[currArg]);
            validateOptionalArgType('Query.onSnapshot', 'function', currArg + 1, args[currArg + 1]);
            validateOptionalArgType('Query.onSnapshot', 'function', currArg + 2, args[currArg + 2]);
            observer = {
                next: args[currArg],
                error: args[currArg + 1],
                complete: args[currArg + 2]
            };
        }
        return this.onSnapshotInternal(options, observer);
    };
    Query.prototype.onSnapshotInternal = function (options, observer) {
        var _this = this;
        var errHandler = function (err) {
            console.error('Uncaught Error in onSnapshot:', err);
        };
        if (observer.error) {
            errHandler = observer.error.bind(observer);
        }
        var asyncObserver = new AsyncObserver({
            next: function (result) {
                if (observer.next) {
                    observer.next(new QuerySnapshot(_this.firestore, _this._query, result));
                }
            },
            error: errHandler
        });
        var firestoreClient = this.firestore.ensureClientConfigured();
        var internalListener = firestoreClient.listen(this._query, asyncObserver, options);
        return function () {
            asyncObserver.mute();
            firestoreClient.unlisten(internalListener);
        };
    };
    Query.prototype.get = function () {
        var _this = this;
        validateExactNumberOfArgs('Query.get', arguments, 0);
        return new Promise(function (resolve, reject) {
            var unlisten = _this.onSnapshotInternal({
                includeDocumentMetadataChanges: false,
                includeQueryMetadataChanges: true,
                waitForSyncWhenOnline: true
            }, {
                next: function (result) {
                    // Remove query first before passing event to user to avoid
                    // user actions affecting the now stale query.
                    unlisten();
                    resolve(result);
                },
                error: reject
            });
        });
    };
    Query.prototype.validateNewFilter = function (filter) {
        if (filter instanceof RelationFilter && filter.isInequality()) {
            var existingField = this._query.getInequalityFilterField();
            if (existingField !== null && !existingField.equals(filter.field)) {
                throw new FirestoreError(Code.INVALID_ARGUMENT, 'Invalid query. All where filters with an inequality' +
                    ' (<, <=, >, or >=) must be on the same field. But you have' +
                    (" inequality filters on '" + existingField.toString() + "'") +
                    (" and '" + filter.field.toString() + "'"));
            }
            var firstOrderByField = this._query.getFirstOrderByField();
            if (firstOrderByField !== null) {
                this.validateOrderByAndInequalityMatch(filter.field, firstOrderByField);
            }
        }
    };
    Query.prototype.validateNewOrderBy = function (orderBy) {
        if (this._query.getFirstOrderByField() === null) {
            // This is the first order by. It must match any inequality.
            var inequalityField = this._query.getInequalityFilterField();
            if (inequalityField !== null) {
                this.validateOrderByAndInequalityMatch(inequalityField, orderBy.field);
            }
        }
    };
    Query.prototype.validateOrderByAndInequalityMatch = function (inequality, orderBy) {
        if (!orderBy.equals(inequality)) {
            throw new FirestoreError(Code.INVALID_ARGUMENT, "Invalid query. You have a where filter with an inequality " +
                ("(<, <=, >, or >=) on field '" + inequality.toString() + "' ") +
                ("and so you must also use '" + inequality.toString() + "' ") +
                "as your first Query.orderBy(), but your first Query.orderBy() " +
                ("is on field '" + orderBy.toString() + "' instead."));
        }
    };
    return Query;
}());
export { Query };
var QuerySnapshot = /** @class */ (function () {
    function QuerySnapshot(_firestore, _originalQuery, _snapshot) {
        this._firestore = _firestore;
        this._originalQuery = _originalQuery;
        this._snapshot = _snapshot;
        this._cachedChanges = null;
        this.metadata = {
            fromCache: _snapshot.fromCache,
            hasPendingWrites: _snapshot.hasPendingWrites
        };
    }
    Object.defineProperty(QuerySnapshot.prototype, "docs", {
        get: function () {
            var result = [];
            this.forEach(function (doc) { return result.push(doc); });
            return result;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(QuerySnapshot.prototype, "empty", {
        get: function () {
            return this._snapshot.docs.isEmpty();
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(QuerySnapshot.prototype, "size", {
        get: function () {
            return this._snapshot.docs.size;
        },
        enumerable: true,
        configurable: true
    });
    QuerySnapshot.prototype.forEach = function (callback, thisArg) {
        var _this = this;
        validateBetweenNumberOfArgs('QuerySnapshot.forEach', arguments, 1, 2);
        validateArgType('QuerySnapshot.forEach', 'function', 1, callback);
        this._snapshot.docs.forEach(function (doc) {
            callback.call(thisArg, _this.convertToDocumentImpl(doc));
        });
    };
    Object.defineProperty(QuerySnapshot.prototype, "query", {
        get: function () {
            return new Query(this._originalQuery, this._firestore);
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(QuerySnapshot.prototype, "docChanges", {
        get: function () {
            if (!this._cachedChanges) {
                this._cachedChanges = changesFromSnapshot(this._firestore, this._snapshot);
            }
            return this._cachedChanges;
        },
        enumerable: true,
        configurable: true
    });
    QuerySnapshot.prototype.convertToDocumentImpl = function (doc) {
        return new DocumentSnapshot(this._firestore, doc.key, doc, this.metadata.fromCache);
    };
    return QuerySnapshot;
}());
export { QuerySnapshot };
var CollectionReference = /** @class */ (function (_super) {
    __extends(CollectionReference, _super);
    function CollectionReference(path, firestore) {
        var _this = _super.call(this, InternalQuery.atPath(path), firestore) || this;
        if (path.length % 2 !== 1) {
            throw new FirestoreError(Code.INVALID_ARGUMENT, 'Invalid collection reference. Collection ' +
                'references must have an odd number of segments, but ' +
                (path.canonicalString() + " has " + path.length));
        }
        return _this;
    }
    Object.defineProperty(CollectionReference.prototype, "id", {
        get: function () {
            return this._query.path.lastSegment();
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(CollectionReference.prototype, "parent", {
        get: function () {
            var parentPath = this._query.path.popLast();
            if (parentPath.isEmpty()) {
                return null;
            }
            else {
                return new DocumentReference(new DocumentKey(parentPath), this.firestore);
            }
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(CollectionReference.prototype, "path", {
        get: function () {
            return this._query.path.canonicalString();
        },
        enumerable: true,
        configurable: true
    });
    CollectionReference.prototype.doc = function (pathString) {
        validateBetweenNumberOfArgs('CollectionReference.doc', arguments, 0, 1);
        // We allow omission of 'pathString' but explicitly prohibit passing in both
        // 'undefined' and 'null'.
        if (arguments.length === 0) {
            pathString = AutoId.newId();
        }
        validateArgType('CollectionReference.doc', 'string', 1, pathString);
        if (pathString === '') {
            throw new FirestoreError(Code.INVALID_ARGUMENT, 'Document path must be a non-empty string');
        }
        var path = ResourcePath.fromString(pathString);
        return DocumentReference.forPath(this._query.path.child(path), this.firestore);
    };
    CollectionReference.prototype.add = function (value) {
        validateExactNumberOfArgs('CollectionReference.add', arguments, 1);
        validateArgType('CollectionReference.add', 'object', 1, value);
        var docRef = this.doc();
        return docRef.set(value).then(function () { return docRef; });
    };
    return CollectionReference;
}(Query));
export { CollectionReference };
function validateSetOptions(methodName, options) {
    if (options === undefined) {
        return {
            merge: false
        };
    }
    validateOptionNames(methodName, options, ['merge']);
    validateNamedOptionalType(methodName, 'boolean', 'merge', options.merge);
    return options;
}
function validateReference(methodName, documentRef, firestore) {
    if (!(documentRef instanceof DocumentReference)) {
        throw invalidClassError(methodName, 'DocumentReference', 1, documentRef);
    }
    else if (documentRef.firestore !== firestore) {
        throw new FirestoreError(Code.INVALID_ARGUMENT, 'Provided document reference is from a different Firestore instance.');
    }
    else {
        return documentRef;
    }
}
/**
 * Calculates the array of firestore.DocumentChange's for a given ViewSnapshot.
 *
 * Exported for testing.
 */
export function changesFromSnapshot(firestore, snapshot) {
    if (snapshot.oldDocs.isEmpty()) {
        // Special case the first snapshot because index calculation is easy and
        // fast
        var lastDoc_1;
        var index_1 = 0;
        return snapshot.docChanges.map(function (change) {
            var doc = new DocumentSnapshot(firestore, change.doc.key, change.doc, snapshot.fromCache);
            assert(change.type === ChangeType.Added, 'Invalid event type for first snapshot');
            assert(!lastDoc_1 || snapshot.query.docComparator(lastDoc_1, change.doc) < 0, 'Got added events in wrong order');
            lastDoc_1 = change.doc;
            return {
                type: 'added',
                doc: doc,
                oldIndex: -1,
                newIndex: index_1++
            };
        });
    }
    else {
        // A DocumentSet that is updated incrementally as changes are applied to use
        // to lookup the index of a document.
        var indexTracker_1 = snapshot.oldDocs;
        return snapshot.docChanges.map(function (change) {
            var doc = new DocumentSnapshot(firestore, change.doc.key, change.doc, snapshot.fromCache);
            var oldIndex = -1;
            var newIndex = -1;
            if (change.type !== ChangeType.Added) {
                oldIndex = indexTracker_1.indexOf(change.doc.key);
                assert(oldIndex >= 0, 'Index for document not found');
                indexTracker_1 = indexTracker_1.delete(change.doc.key);
            }
            if (change.type !== ChangeType.Removed) {
                indexTracker_1 = indexTracker_1.add(change.doc);
                newIndex = indexTracker_1.indexOf(change.doc.key);
            }
            return { type: resultChangeType(change.type), doc: doc, oldIndex: oldIndex, newIndex: newIndex };
        });
    }
}
function resultChangeType(type) {
    switch (type) {
        case ChangeType.Added:
            return 'added';
        case ChangeType.Modified:
        case ChangeType.Metadata:
            return 'modified';
        case ChangeType.Removed:
            return 'removed';
        default:
            return fail('Unknown change type: ' + type);
    }
}
// Export the classes with a private constructor (it will fail if invoked
// at runtime). Note that this still allows instanceof checks.
// We're treating the variables as class names, so disable checking for lower
// case variable names.
// tslint:disable:variable-name
export var PublicFirestore = makeConstructorPrivate(Firestore, 'Use firebase.firestore() instead.');
export var PublicTransaction = makeConstructorPrivate(Transaction, 'Use firebase.firestore().runTransaction() instead.');
export var PublicWriteBatch = makeConstructorPrivate(WriteBatch, 'Use firebase.firestore().batch() instead.');
export var PublicDocumentReference = makeConstructorPrivate(DocumentReference, 'Use firebase.firestore().doc() instead.');
export var PublicDocumentSnapshot = makeConstructorPrivate(DocumentSnapshot);
export var PublicQuery = makeConstructorPrivate(Query);
export var PublicQuerySnapshot = makeConstructorPrivate(QuerySnapshot);
export var PublicCollectionReference = makeConstructorPrivate(CollectionReference, 'Use firebase.firestore().collection() instead.');
// tslint:enable:variable-name

//# sourceMappingURL=database.js.map
