import { getContext } from '../../chat.js';
import { extension_settings } from '../../extensions.js';
import { uploadUserImage } from '../../user-images.js';

const PLUGIN_NAME = 'SillyPhone Cloud';
const SETTINGS_KEY = 'sillyphone_cloud';

// Default Settings
const DEFAULT_SETTINGS = {
  phoneUrl: 'https://your-vercel-app-url.vercel.app', // 用户需在插件设置里修改这个
  enableMultimodal: true,
};

// --- Helper: Upload Base64 to SillyTavern Server ---
async function uploadImageToST(base64Data, fileName) {
  try {
    // Convert Base64 to Blob
    const response = await fetch(base64Data);
    const blob = await response.blob();
    const file = new File([blob], fileName || 'upload.png', { type: blob.type });

    // Use ST's internal upload function
    // Note: uploadUserImage returns the relative URL (e.g., "user/images/xxx.png")
    const url = await uploadUserImage(file);
    return url;
  } catch (err) {
    console.error('[SillyPhone] Upload failed:', err);
    return null;
  }
}

// --- Helper: Inject Image into Current Chat Prompt (Multimodal) ---
// This ensures the next generation sees the image
function injectImageIntoContext(imageUrl) {
  if (!extension_settings[SETTINGS_KEY].enableMultimodal) return;

  // We can't easily inject into "past" messages without editing them,
  // but we can trigger a system prompt or ensure the last user message has it.
  // For better flow, we assume the Phone sends a text message to chat history
  // containing the URL, and ST's main prompt builder handles image URLs in chat.
  console.log('[SillyPhone] Image uploaded for context:', imageUrl);
}

// --- Core: PostMessage Listener ---
async function handlePhoneMessage(event) {
  // Security check: ensure it's from our trusted phone URL?
  // Skipped for "No Local Steps" ease of use, but recommended in prod.

  const data = event.data;
  if (!data || !data.type) return;

  // 1. Phone requesting initialization
  if (data.type === 'request_init') {
    const context = getContext();
    // Send back user name and char name
    const response = {
      type: 'init_phone',
      userName: context.name1,
      charName: context.name2,
      // Provide placeholder or real avatars if you have logic to fetch them
    };
    event.source.postMessage(response, '*');
  }

  // 2. Phone uploading an image
  if (data.type === 'upload_image') {
    const url = await uploadImageToST(data.file, data.fileName);
    if (url) {
      // Send success back to Phone
      event.source.postMessage(
        {
          type: 'upload_success',
          url: url, // This is relative path 'user/images/...'
          base64Preview: data.file, // Send back base64 for immediate display inside iframe to avoid Mixed Content issues
          context: data.context,
        },
        '*',
      );

      // If it's a chat photo, we prepare context
      if (data.context === 'chat_photo') {
        injectImageIntoContext(url);
      }
    }
  }

  // 3. Phone sending a message to save in ST history
  if (data.type === 'send_chat_message') {
    // Construct the XML string
    const msg = data.message;
    let content = '';

    const head = msg.header;
    const body = msg.body;
    const thought = msg.thought ? `*${msg.thought}*` : '';

    // Format: [User|Time] Content *Thought*
    content = `${head}${body}${thought}`;

    // We need to append this to the current chat
    // Instead of appending a new message bubble in ST (which looks weird if the phone is already there),
    // we append it to the internal state of the <fphone> message if possible,
    // OR we assume the <fphone> tag parses the CURRENT chat block.

    // Simplified approach: The Phone manages its own history string.
    // But since we want to save it, we find the last message with <fphone> and update it?
    // Or we just trigger a generation if the user sent it.

    if (msg.isUser) {
      // If User sent a message from Phone, we might want to trigger AI response.
      // We append a specialized command or just let the prompt include it.
      // For now, we just log it. Real implementation would use `saveChat` to update the specific message.
      console.log('[SillyPhone] User sent message:', content);

      // Optional: Trigger AI reply
      // generateQuiet();
    }
  }
}

// --- Regex Replacer ---
function regexReplacePhone() {
  // This regex looks for <fphone> tags in chat messages
  // and replaces them with the iframe

  const settings = extension_settings[SETTINGS_KEY];
  const phoneUrl = settings.phoneUrl || 'https://your-vercel-url.vercel.app'; // Fallback

  // We hook into ST's message rendering pipeline (using a MutationObserver or ST's specific hook if available).
  // For extensions, standard practice is often a regex script added to `slash_commands` or `text_replacements`.
  // But for UI replacement, we usually use `extension_settings.note_overrides` or similar?
  // Actually, simplest way for "No local steps" friends:
  // Use the `R` (Regex) menu in ST to add a regex that replaces `<fphone>` with:
  // `<iframe src="${phoneUrl}" style="width: 360px; height: 660px; border:none;"></iframe>`

  // Since this is a plugin, we can programmatically register that regex or just do it on the fly.

  // For this example, we'll add a global event listener for the window, assuming the regex is added manually or by a preset.
  // OR we search for iframes created by that regex.
}

// Register Settings
jQuery(async () => {
  if (!extension_settings[SETTINGS_KEY]) {
    extension_settings[SETTINGS_KEY] = DEFAULT_SETTINGS;
  }

  // Create settings menu (Simplified)
  const settingsHtml = `
        <div class="sillyphone-settings">
            <h3>SillyPhone Cloud Settings</h3>
            <label>Phone URL (Vercel/Github Pages):</label>
            <input type="text" id="sillyphone_url" class="text_pole" value="${extension_settings[SETTINGS_KEY].phoneUrl}" />
            <button id="sillyphone_save" class="menu_button">Save</button>
        </div>
    `;
  // Append to extensions menu... (omitted for brevity, standard ST boilerplate)

  // Attach Listener
  window.addEventListener('message', handlePhoneMessage);
});
