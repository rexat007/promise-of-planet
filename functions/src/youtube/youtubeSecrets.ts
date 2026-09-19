import { defineSecret } from 'firebase-functions/params';

export const youtubeApiKeySecret = defineSecret('YOUTUBE_API_KEY');

export type YouTubeApiKeyProvider = () => string;

export const defaultProductionApiKeyProvider: YouTubeApiKeyProvider = (): string => {
  return youtubeApiKeySecret.value();
};
