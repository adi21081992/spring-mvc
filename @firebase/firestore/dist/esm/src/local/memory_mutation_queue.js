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
import { DocumentKey } from '../model/document_key';
import { BATCHID_UNKNOWN, MutationBatch } from '../model/mutation_batch';
import { emptyByteString } from '../platform/platform';
import { assert } from '../util/assert';
import { primitiveComparator } from '../util/misc';
import { SortedSet } from '../util/sorted_set';
import { PersistencePromise } from './persistence_promise';
import { DocReference } from './reference_set';
var MemoryMutationQueue = /** @class */ (function () {
    function MemoryMutationQueue() {
        /**
         * The set of all mutations that have been sent but not yet been applied to
         * the backend.
         */
        this.mutationQueue = [];
        /** Next value to use when assigning sequential IDs to each mutation batch. */
        this.nextBatchId = 1;
        /** The highest acknowledged mutation in the queue. */
        this.highestAcknowledgedBatchId = BATCHID_UNKNOWN;
        /** The last received stream token from the server, used to acknowledge which
         * responses the client has processed. Stream tokens are opaque checkpoint
         * markers whose only real value is their inclusion in the next request.
         */
        this.lastStreamToken = emptyByteString();
        /** The garbage collector to notify about potential garbage keys. */
        this.garbageCollector = null;
        /** An ordered mapping between documents and the mutations batch IDs. */
        this.batchesByDocumentKey = new SortedSet(DocReference.compareByKey);
    }
    MemoryMutationQueue.prototype.start = function (transaction) {
        // NOTE: The queue may be shutdown / started multiple times, since we
        // maintain the queue for the duration of the app session in case a user
        // logs out / back in. To behave like the LevelDB-backed MutationQueue (and
        // accommodate tests that expect as much), we reset nextBatchId and
        // highestAcknowledgedBatchId if the queue is empty.
        if (this.mutationQueue.length === 0) {
            this.nextBatchId = 1;
            this.highestAcknowledgedBatchId = BATCHID_UNKNOWN;
        }
        assert(this.highestAcknowledgedBatchId < this.nextBatchId, 'highestAcknowledgedBatchId must be less than the nextBatchId');
        return PersistencePromise.resolve();
    };
    MemoryMutationQueue.prototype.checkEmpty = function (transaction) {
        return PersistencePromise.resolve(this.mutationQueue.length === 0);
    };
    MemoryMutationQueue.prototype.getNextBatchId = function (transaction) {
        return PersistencePromise.resolve(this.nextBatchId);
    };
    MemoryMutationQueue.prototype.getHighestAcknowledgedBatchId = function (transaction) {
        return PersistencePromise.resolve(this.highestAcknowledgedBatchId);
    };
    MemoryMutationQueue.prototype.acknowledgeBatch = function (transaction, batch, streamToken) {
        var batchId = batch.batchId;
        assert(batchId > this.highestAcknowledgedBatchId, 'Mutation batchIDs must be acknowledged in order');
        var batchIndex = this.indexOfExistingBatchId(batchId, 'acknowledged');
        // Verify that the batch in the queue is the one to be acknowledged.
        var check = this.mutationQueue[batchIndex];
        assert(batchId === check.batchId, 'Queue ordering failure: expected batch ' +
            batchId +
            ', got batch ' +
            check.batchId);
        assert(!check.isTombstone(), "Can't acknowledge a previously removed batch");
        this.highestAcknowledgedBatchId = batchId;
        this.lastStreamToken = streamToken;
        return PersistencePromise.resolve();
    };
    MemoryMutationQueue.prototype.getLastStreamToken = function (transaction) {
        return PersistencePromise.resolve(this.lastStreamToken);
    };
    MemoryMutationQueue.prototype.setLastStreamToken = function (transaction, streamToken) {
        this.lastStreamToken = streamToken;
        return PersistencePromise.resolve();
    };
    MemoryMutationQueue.prototype.addMutationBatch = function (transaction, localWriteTime, mutations) {
        assert(mutations.length !== 0, 'Mutation batches should not be empty');
        var batchId = this.nextBatchId;
        this.nextBatchId++;
        if (this.mutationQueue.length > 0) {
            var prior = this.mutationQueue[this.mutationQueue.length - 1];
            assert(prior.batchId < batchId, 'Mutation batchIDs must be monotonically increasing order');
        }
        var batch = new MutationBatch(batchId, localWriteTime, mutations);
        this.mutationQueue.push(batch);
        // Track references by document key.
        for (var _i = 0, mutations_1 = mutations; _i < mutations_1.length; _i++) {
            var mutation = mutations_1[_i];
            this.batchesByDocumentKey = this.batchesByDocumentKey.add(new DocReference(mutation.key, batchId));
        }
        return PersistencePromise.resolve(batch);
    };
    MemoryMutationQueue.prototype.lookupMutationBatch = function (transaction, batchId) {
        return PersistencePromise.resolve(this.findMutationBatch(batchId));
    };
    MemoryMutationQueue.prototype.getNextMutationBatchAfterBatchId = function (transaction, batchId) {
        var size = this.mutationQueue.length;
        // All batches with batchId <= this.highestAcknowledgedBatchId have been
        // acknowledged so the first unacknowledged batch after batchID will have a
        // batchID larger than both of these values.
        batchId = Math.max(batchId + 1, this.highestAcknowledgedBatchId);
        // The requested batchId may still be out of range so normalize it to the
        // start of the queue.
        var rawIndex = this.indexOfBatchId(batchId);
        var index = rawIndex < 0 ? 0 : rawIndex;
        // Finally return the first non-tombstone batch.
        for (; index < size; index++) {
            var batch = this.mutationQueue[index];
            if (!batch.isTombstone()) {
                return PersistencePromise.resolve(batch);
            }
        }
        return PersistencePromise.resolve(null);
    };
    MemoryMutationQueue.prototype.getAllMutationBatches = function (transaction) {
        return PersistencePromise.resolve(this.getAllLiveMutationBatchesBeforeIndex(this.mutationQueue.length));
    };
    MemoryMutationQueue.prototype.getAllMutationBatchesThroughBatchId = function (transaction, batchId) {
        var count = this.mutationQueue.length;
        var endIndex = this.indexOfBatchId(batchId);
        if (endIndex < 0) {
            endIndex = 0;
        }
        else if (endIndex >= count) {
            endIndex = count;
        }
        else {
            // The endIndex is in the queue so increment to pull everything in the
            // queue including it.
            endIndex++;
        }
        return PersistencePromise.resolve(this.getAllLiveMutationBatchesBeforeIndex(endIndex));
    };
    MemoryMutationQueue.prototype.getAllMutationBatchesAffectingDocumentKey = function (transaction, documentKey) {
        var _this = this;
        var start = new DocReference(documentKey, 0);
        var end = new DocReference(documentKey, Number.POSITIVE_INFINITY);
        var result = [];
        this.batchesByDocumentKey.forEachInRange([start, end], function (ref) {
            assert(documentKey.equals(ref.key), "Should only iterate over a single key's batches");
            var batch = _this.findMutationBatch(ref.targetOrBatchId);
            assert(batch !== null, 'Batches in the index must exist in the main table');
            result.push(batch);
        });
        return PersistencePromise.resolve(result);
    };
    MemoryMutationQueue.prototype.getAllMutationBatchesAffectingQuery = function (transaction, query) {
        var _this = this;
        // Use the query path as a prefix for testing if a document matches the
        // query.
        var prefix = query.path;
        var immediateChildrenPathLength = prefix.length + 1;
        // Construct a document reference for actually scanning the index. Unlike
        // the prefix the document key in this reference must have an even number of
        // segments. The empty segment can be used a suffix of the query path
        // because it precedes all other segments in an ordered traversal.
        var startPath = prefix;
        if (!DocumentKey.isDocumentKey(startPath)) {
            startPath = startPath.child('');
        }
        var start = new DocReference(new DocumentKey(startPath), 0);
        // Find unique batchIDs referenced by all documents potentially matching the
        // query.
        var uniqueBatchIDs = new SortedSet(primitiveComparator);
        this.batchesByDocumentKey.forEachWhile(function (ref) {
            var rowKeyPath = ref.key.path;
            if (!prefix.isPrefixOf(rowKeyPath)) {
                return false;
            }
            else {
                // Rows with document keys more than one segment longer than the query
                // path can't be matches. For example, a query on 'rooms' can't match
                // the document /rooms/abc/messages/xyx.
                // TODO(mcg): we'll need a different scanner when we implement
                // ancestor queries.
                if (rowKeyPath.length === immediateChildrenPathLength) {
                    uniqueBatchIDs = uniqueBatchIDs.add(ref.targetOrBatchId);
                }
                return true;
            }
        }, start);
        // Construct an array of matching batches, sorted by batchID to ensure that
        // multiple mutations affecting the same document key are applied in order.
        var result = [];
        uniqueBatchIDs.forEach(function (batchId) {
            var batch = _this.findMutationBatch(batchId);
            if (batch !== null) {
                result.push(batch);
            }
        });
        return PersistencePromise.resolve(result);
    };
    MemoryMutationQueue.prototype.removeMutationBatches = function (transaction, batches) {
        var batchCount = batches.length;
        assert(batchCount > 0, 'Should not remove mutations when none exist.');
        var firstBatchId = batches[0].batchId;
        var queueCount = this.mutationQueue.length;
        // Find the position of the first batch for removal. This need not be the
        // first entry in the queue.
        var startIndex = this.indexOfExistingBatchId(firstBatchId, 'removed');
        assert(this.mutationQueue[startIndex].batchId === firstBatchId, 'Removed batches must exist in the queue');
        // Check that removed batches are contiguous (while excluding tombstones).
        var batchIndex = 1;
        var queueIndex = startIndex + 1;
        while (batchIndex < batchCount && queueIndex < queueCount) {
            var batch = this.mutationQueue[queueIndex];
            if (batch.isTombstone()) {
                queueIndex++;
                continue;
            }
            assert(batch.batchId === batches[batchIndex].batchId, 'Removed batches must be contiguous in the queue');
            batchIndex++;
            queueIndex++;
        }
        // Only actually remove batches if removing at the front of the queue.
        // Previously rejected batches may have left tombstones in the queue, so
        // expand the removal range to include any tombstones.
        if (startIndex === 0) {
            for (; queueIndex < queueCount; queueIndex++) {
                var batch = this.mutationQueue[queueIndex];
                if (!batch.isTombstone()) {
                    break;
                }
            }
            var length_1 = queueIndex - startIndex;
            this.mutationQueue.splice(startIndex, length_1);
        }
        else {
            // Mark the tombstones
            for (var i = startIndex; i < queueIndex; i++) {
                this.mutationQueue[i] = this.mutationQueue[i].toTombstone();
            }
        }
        var references = this.batchesByDocumentKey;
        for (var _i = 0, batches_1 = batches; _i < batches_1.length; _i++) {
            var batch = batches_1[_i];
            var batchId = batch.batchId;
            for (var _a = 0, _b = batch.mutations; _a < _b.length; _a++) {
                var mutation = _b[_a];
                var key = mutation.key;
                if (this.garbageCollector !== null) {
                    this.garbageCollector.addPotentialGarbageKey(key);
                }
                var ref = new DocReference(key, batchId);
                references = references.delete(ref);
            }
        }
        this.batchesByDocumentKey = references;
        return PersistencePromise.resolve();
    };
    MemoryMutationQueue.prototype.setGarbageCollector = function (garbageCollector) {
        this.garbageCollector = garbageCollector;
    };
    MemoryMutationQueue.prototype.containsKey = function (txn, key) {
        var ref = new DocReference(key, 0);
        var firstRef = this.batchesByDocumentKey.firstAfterOrEqual(ref);
        return PersistencePromise.resolve(key.equals(firstRef && firstRef.key));
    };
    MemoryMutationQueue.prototype.performConsistencyCheck = function (txn) {
        if (this.mutationQueue.length === 0) {
            assert(this.batchesByDocumentKey.isEmpty(), 'Document leak -- detected dangling mutation references when queue is empty.');
        }
        return PersistencePromise.resolve();
    };
    /**
     * A private helper that collects all the mutations batches in the queue up to
     * but not including the given endIndex. All tombstones in the queue are
     * excluded.
     */
    MemoryMutationQueue.prototype.getAllLiveMutationBatchesBeforeIndex = function (endIndex) {
        var result = [];
        for (var i = 0; i < endIndex; i++) {
            var batch = this.mutationQueue[i];
            if (!batch.isTombstone()) {
                result.push(batch);
            }
        }
        return result;
    };
    /**
     * Finds the index of the given batchId in the mutation queue and asserts that
     * the resulting index is within the bounds of the queue.
     *
     * @param batchId The batchId to search for
     * @param action A description of what the caller is doing, phrased in passive
     * form (e.g. "acknowledged" in a routine that acknowledges batches).
     */
    MemoryMutationQueue.prototype.indexOfExistingBatchId = function (batchId, action) {
        var index = this.indexOfBatchId(batchId);
        assert(index >= 0 && index < this.mutationQueue.length, 'Batches must exist to be ' + action);
        return index;
    };
    /**
     * Finds the index of the given batchId in the mutation queue. This operation
     * is O(1).
     *
     * @return The computed index of the batch with the given batchId, based on
     * the state of the queue. Note this index can be negative if the requested
     * batchId has already been remvoed from the queue or past the end of the
     * queue if the batchId is larger than the last added batch.
     */
    MemoryMutationQueue.prototype.indexOfBatchId = function (batchId) {
        if (this.mutationQueue.length === 0) {
            // As an index this is past the end of the queue
            return 0;
        }
        // Examine the front of the queue to figure out the difference between the
        // batchId and indexes in the array. Note that since the queue is ordered
        // by batchId, if the first batch has a larger batchId then the requested
        // batchId doesn't exist in the queue.
        var firstBatchId = this.mutationQueue[0].batchId;
        return batchId - firstBatchId;
    };
    /**
     * A version of lookupMutationBatch that doesn't return a promise, this makes
     * other functions that uses this code easier to read and more efficent.
     */
    MemoryMutationQueue.prototype.findMutationBatch = function (batchId) {
        var index = this.indexOfBatchId(batchId);
        if (index < 0 || index >= this.mutationQueue.length) {
            return null;
        }
        var batch = this.mutationQueue[index];
        assert(batch.batchId === batchId, 'If found batch must match');
        return batch.isTombstone() ? null : batch;
    };
    return MemoryMutationQueue;
}());
export { MemoryMutationQueue };

//# sourceMappingURL=memory_mutation_queue.js.map
