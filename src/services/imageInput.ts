import * as ImagePicker from 'expo-image-picker';

/**
 * Image → chat input (GAP-A6).
 *
 * The picker returns base64 directly, so no extra file-system round trip is
 * needed: the payload is handed to Groq as an OpenAI-style `image_url` data
 * URL. The default chat model (`qwen/qwen3.8-27b`) is multimodal *and* keeps
 * tool use, so no model switch is required for an attached image.
 *
 * Groq caps a vision request at 20 MB; we cap far lower so a phone photo does
 * not silently blow the request budget or the reply deadline.
 */

/** ~3 MB of decoded base64 — comfortably inside Groq's 20 MB ceiling. */
export const MAX_IMAGE_DATA_URL_CHARS = 3_000_000;

export interface PickedImage {
  /** `data:<mime>;base64,<payload>` ready for `image_url.url`. */
  dataUrl: string;
  /** Local file URI, for rendering a thumbnail in the transcript. */
  uri: string;
}

export class ImageTooLargeError extends Error {
  constructor() {
    super('That image is too large, sir. Please choose one under about 3 MB.');
    this.name = 'ImageTooLargeError';
  }
}

/** Launch the system photo library. Returns null when the user cancels. */
export async function pickLibraryImage(): Promise<PickedImage | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      'Photo library access is needed to attach an image. Enable it in Settings.'
    );
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.6,
    base64: true,
    allowsEditing: false,
  });

  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset?.base64) {
    throw new Error('That image could not be read. Please pick another one.');
  }

  const mime = asset.mimeType || 'image/jpeg';
  const dataUrl = `data:${mime};base64,${asset.base64}`;
  if (dataUrl.length > MAX_IMAGE_DATA_URL_CHARS) throw new ImageTooLargeError();

  return { dataUrl, uri: asset.uri };
}
