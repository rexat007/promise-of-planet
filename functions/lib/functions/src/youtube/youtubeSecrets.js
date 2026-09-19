"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultProductionApiKeyProvider = exports.youtubeApiKeySecret = void 0;
const params_1 = require("firebase-functions/params");
exports.youtubeApiKeySecret = (0, params_1.defineSecret)('YOUTUBE_API_KEY');
const defaultProductionApiKeyProvider = () => {
    return exports.youtubeApiKeySecret.value();
};
exports.defaultProductionApiKeyProvider = defaultProductionApiKeyProvider;
//# sourceMappingURL=youtubeSecrets.js.map