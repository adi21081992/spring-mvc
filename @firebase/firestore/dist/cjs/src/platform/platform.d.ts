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
import { DatabaseId, DatabaseInfo } from '../core/database_info';
import { ProtoByteString } from '../core/types';
import { Connection } from '../remote/connection';
import { JsonProtoSerializer } from '../remote/serializer';
/**
 * Provides a common interface to load anything platform dependent, e.g.
 * the connection implementation.
 *
 * An implementation of this must be provided at compile time for the platform.
 */
export interface Platform {
    loadConnection(databaseInfo: DatabaseInfo): Promise<Connection>;
    newSerializer(databaseId: DatabaseId): JsonProtoSerializer;
    /** Converts a Base64 encoded string to a binary string. */
    atob(encoded: string): string;
    /** Converts a binary string to a Base64 encoded string. */
    btoa(raw: string): string;
    /** True if and only if the Base64 conversion functions are available. */
    readonly base64Available: boolean;
    readonly emptyByteString: ProtoByteString;
}
/**
 * Provides singleton helpers where setup code can inject a platform at runtime.
 * setPlatform needs to be set before Firestore is used and must be set exactly
 * once.
 */
export declare class PlatformSupport {
    private static platform;
    static setPlatform(platform: Platform): void;
    static getPlatform(): Platform;
}
/**
 * Returns the representation of an empty "proto" byte string for the
 * platform.
 */
export declare function emptyByteString(): ProtoByteString;
