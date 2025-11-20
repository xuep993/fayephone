
import { extension_settings } from "../../extensions.js";
import { uploadUserImage } from "../../user-images.js";
import { getContext } from "../../chat.js";

const PLUGIN_NAME = "SillyPhone Cloud";
const SETTINGS_KEY = "sillyphone_cloud";

// 你的真实地址 (Cloudflare Pages)
const DEFAULT_SETTINGS = {
    phoneUrl: "https://fayephone.pages.dev/fphone/", 
    enableMultimodal: true
};

// --- Helper: Upload Base64 to SillyTavern Server ---
async function uploadImageToST(base64Data, fileName) {
    try {
        const response = await fetch(base64Data);
        const blob = await response.blob();
        const file = new File([blob], fileName || "upload.png", { type: blob.type });
        const url = await uploadUserImage(file);
        return url;
    } catch (err) {
        console.error("[SillyPhone] Upload failed:", err);
        return null;
    }
}

// --- Core: PostMessage Listener ---
async function handlePhoneMessage(event) {
    const data = event.data;
    if (!data || !data.type) return;

    // 1. Phone requesting initialization
    if (data.type === 'request_init') {
        const context = getContext();
        const response = {
            type: 'init_phone',
            userName: context.name1,
            charName: context.name2,
        };
        event.source.postMessage(response, '*');
    }
    
    // 2. Phone uploading an image
    if (data.type === 'upload_image') {
        const url = await uploadImageToST(data.file, data.fileName);
        if (url) {
            event.source.postMessage({
                type: 'upload_success',
                url: url, 
                base64Preview: data.file, 
                context: data.context
            }, '*');
            
            if (data.context === 'chat_photo') {
                console.log("[SillyPhone] Image uploaded:", url);
            }
        }
    }

    // 3. Phone sending a message to save in ST history
    if (data.type === 'send_chat_message') {
        console.log("[SillyPhone] History update request from phone");
    }
}

// --- Register Slash Command (/phone) ---
function registerPhoneCommand() {
    if (window.SlashCommandParser && window.SlashCommandParser.addCommandObject) {
        window.SlashCommandParser.addCommandObject(window.SlashCommand.fromProps({
            name: 'phone',
            callback: (args, value) => {
                const url = extension_settings[SETTINGS_KEY].phoneUrl;
                return `<iframe src="${url}" style="width: 375px; height: 680px; border:none; user-select:none; border-radius: 20px; margin: 0 auto; display: block;" allow="clipboard-write"></iframe>`;
            },
            helpString: "Insert the SillyPhone iframe (插入云端小手机)"
        }));
    }
}

// --- Auto-Replace <fphone> Tag ---
function startTagObserver() {
    // Watch the chat container for new messages
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) { // Element
                    // Find .mes_text elements inside the new node (or the node itself)
                    const textNodes = $(node).find('.mes_text').addBack('.mes_text');
                    textNodes.each(function() {
                        let html = $(this).html();
                        // Check for <fphone> or escaped &lt;fphone&gt;
                        if (html.includes('&lt;fphone&gt;') || html.includes('<fphone>')) {
                            const url = extension_settings[SETTINGS_KEY].phoneUrl;
                            const iframe = `<iframe src="${url}" style="width: 375px; height: 680px; border:none; user-select:none; border-radius: 20px; margin: 0 auto; display: block;" allow="clipboard-write"></iframe>`;
                            // Replace all variations
                            const newHtml = html.replace(/&lt;fphone&gt;|&lt;\/fphone&gt;|<fphone>|<\/fphone>/g, iframe);
                            // Only update if changed to avoid loops
                            if (html !== newHtml) {
                                $(this).html(newHtml);
                            }
                        }
                    });
                }
            });
        });
    });

    // Target the chat container
    const chatTarget = document.querySelector('#chat');
    if (chatTarget) {
        observer.observe(chatTarget, { childList: true, subtree: true });
    }
}

// Register Settings & Listener
jQuery(async () => {
    if (!extension_settings[SETTINGS_KEY]) {
        extension_settings[SETTINGS_KEY] = DEFAULT_SETTINGS;
    }
    
    // Add Settings Menu
    const settingsHtml = `
        <div class="sillyphone-settings">
            <h3>SillyPhone Cloud Settings</h3>
            <label>Phone URL (Cloudflare/GitHub Pages):</label>
            <input type="text" id="sillyphone_url" class="text_pole" value="${extension_settings[SETTINGS_KEY].phoneUrl}" />
            <div style="font-size:0.8em; color:#aaa; margin-top:5px;">默认: https://fayephone.pages.dev/fphone/</div>
            <button id="sillyphone_save" class="menu_button" style="margin-top:10px;">Save URL</button>
        </div>
    `;
    
    $('#extensions_settings').append(settingsHtml);
    
    $('#sillyphone_save').on('click', () => {
        extension_settings[SETTINGS_KEY].phoneUrl = $('#sillyphone_url').val();
        alert("Settings Saved! Please refresh the page if the phone doesn't update immediately.");
    });
    
    // Listen for postMessage
    window.addEventListener('message', handlePhoneMessage);
    
    // Register Command & Observer
    setTimeout(() => {
        registerPhoneCommand();
        startTagObserver();
    }, 1000);
});
