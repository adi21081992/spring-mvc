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
import { Code, FirestoreError } from '../util/error';
import { validateArgType, validateExactNumberOfArgs } from '../util/input_validation';
import { primitiveComparator } from '../util/misc';
/**
 * Immutable class representing a geo point as latitude-longitude pair.
 * This class is directly exposed in the public API, including its constructor.
 */
var GeoPoint = /** @class */ (function () {
    function GeoPoint(latitude, longitude) {
        validateExactNumberOfArgs('GeoPoint', arguments, 2);
        validateArgType('GeoPoint', 'number', 1, latitude);
        validateArgType('GeoPoint', 'number', 2, longitude);
        if (!isFinite(latitude) || latitude < -90 || latitude > 90) {
            throw new FirestoreError(Code.INVALID_ARGUMENT, 'Latitude must be a number between -90 and 90, but was: ' + latitude);
        }
        if (!isFinite(longitude) || longitude < -180 || longitude > 180) {
            throw new FirestoreError(Code.INVALID_ARGUMENT, 'Longitude must be a number between -180 and 180, but was: ' + longitude);
        }
        this._lat = latitude;
        this._long = longitude;
    }
    Object.defineProperty(GeoPoint.prototype, "latitude", {
        /**
         * Returns the latitude of this geo point, a number between -90 and 90.
         */
        get: function () {
            return this._lat;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GeoPoint.prototype, "longitude", {
        /**
         * Returns the longitude of this geo point, a number between -180 and 180.
         */
        get: function () {
            return this._long;
        },
        enumerable: true,
        configurable: true
    });
    /**
     * Actually private to JS consumers of our API, so this function is prefixed
     * with an underscore.
     */
    GeoPoint.prototype._equals = function (other) {
        return this._lat === other._lat && this._long === other._long;
    };
    /**
     * Actually private to JS consumers of our API, so this function is prefixed
     * with an underscore.
     */
    GeoPoint.prototype._compareTo = function (other) {
        return (primitiveComparator(this._lat, other._lat) ||
            primitiveComparator(this._long, other._long));
    };
    return GeoPoint;
}());
export { GeoPoint };

//# sourceMappingURL=geo_point.js.map
