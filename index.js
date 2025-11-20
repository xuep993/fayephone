
import { extension_settings } from "../../extensions.js";
import { uploadUserImage } from "../../user-images.js";
import { getContext, getChat, saveChat, generateQuiet } from "../../chat.js";
import { eventSource, event_types } from "../../../script.js";

const PLUGIN_NAME = "SillyPhone Cloud";
const SETTINGS_KEY = "sillyphone_cloud";

// 你的 Cloudflare Pages 地址
const DEFAULT_SETTINGS = {
    phoneUrl: "https://fayephone.pages.dev/fphone/", 
    enableMultimodal: true // 是否开启自动发图给AI
};

// --- 1. 图片上传处理 (核心防卡顿逻辑) ---
async function uploadImageToST(base64Data, fileName) {
    try {
        // 把 Base64 转回文件对象
        const response = await fetch(base64Data);
        const blob = await response.blob();
        const file = new File([blob], fileName || "phone_upload.png", { type: blob.type });
        
        // 调用 ST 内部 API 保存到 public/user/images/
        // 返回相对路径，例如 "user/images/phone_upload.png"
        const url = await uploadUserImage(file);
        console.log("[SillyPhone] 图片已保存到本地:", url);
        return url;
    } catch (err) {
        console.error("[SillyPhone] 图片保存失败:", err);
        return null;
    }
}

// --- 2. 消息通信处理 (交互核心) ---
async function handlePhoneMessage(event) {
    // 安全性检查：实际使用可以校验 event.origin，这里为了方便先跳过
    const data = event.data;
    if (!data || !data.type) return;

    // A. 手机加载完毕，请求初始化数据
    if (data.type === 'request_init') {
        const context = getContext(); // 获取当前 ST 上下文
        const chat = getChat();       // 获取当前聊天记录
        
        // 找到最后一条包含 <fphone> 的消息，解析它的 content 传给手机
        // 这样手机才能显示出之前的聊天记录
        let historyContent = "";
        for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i].mes && (chat[i].mes.includes('<fphone>') || chat[i].mes.includes('&lt;fphone&gt;'))) {
                // 简单的提取逻辑，提取标签内的内容
                // 这里我们假设手机需要的是原始文本，手机自己会去解析 XML
                historyContent = chat[i].mes; 
                break;
            }
        }

        const response = {
            type: 'init_phone',
            userName: context.name1,
            charName: context.name2,
            history: historyContent // 把历史记录发回去
        };
        event.source.postMessage(response, '*');
    }
    
    // B. 手机请求上传图片 (解决卡顿 + AI识图)
    if (data.type === 'upload_image') {
        const url = await uploadImageToST(data.file, data.fileName);
        if (url) {
            // 1. 告诉手机：图存好了，这是你的 URL
            event.source.postMessage({
                type: 'upload_success',
                url: url, 
                base64Preview: data.file, // 把 Base64 发回去仅做当前预览，不存历史
                context: data.context
            }, '*');
            
            // 2. 如果是聊天图片，注入到 AI 上下文 (Multimodal)
            if (data.context === 'chat_photo' && extension_settings[SETTINGS_KEY].enableMultimodal) {
                // 这是一个 Hack 方法，把图片临时挂载到输入框，模拟用户上传
                // 或者直接修改当前 Prompt。这里最简单的方法是告诉用户“图片已发送给AI”
                // ST 的 `sendImage` 比较复杂，通常我们依靠在消息里写 <img src="..."> 
                // 并在 ST 设置里开启 "Send inline images to model"
                console.log("[SillyPhone] 图片已准备好发送给 AI");
            }
        }
    }

    // C. 手机发送消息 (同步回 ST)
    if (data.type === 'send_chat_message') {
        // 手机发来的是一个新的 XML 片段，我们需要把它更新到当前的 ST 消息里
        // 或者触发一个新的回复
        console.log("[SillyPhone] 收到手机消息:", data.message);
        
        // 如果你想让 ST 记录下这句话，你需要修改当前的聊天消息
        // 这里为了简单，我们假设用户是在编辑当前的小手机状态
        // 真正的高级用法是：调用 saveChat 更新当前消息内容
        // 这样刷新网页后，手机里的内容还在
        
        // 自动触发 AI 回复 (可选)
        // generateQuiet(); 
    }
}

// --- 3. 正则替换 (显示核心) ---
function startTagObserver() {
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) {
                    const textNodes = $(node).find('.mes_text').addBack('.mes_text');
                    textNodes.each(function() {
                        let html = $(this).html();
                        // 捕捉 <fphone> 或 <fphone>内容</fphone>
                        if (html.includes('&lt;fphone&gt;') || html.includes('<fphone>')) {
                            const url = extension_settings[SETTINGS_KEY].phoneUrl;
                            // 关键：允许 allow-scripts 和 allow-same-origin 才能交互
                            const iframe = `
                                <div class="phone-wrapper" style="text-align:center;">
                                    <iframe src="${url}" 
                                        style="width: 375px; height: 680px; border:none; border-radius: 40px; box-shadow: 0 10px 30px rgba(0,0,0,0.3);" 
                                        allow="clipboard-write; clipboard-read"
                                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                                    ></iframe>
                                </div>`;
                            
                            // 替换标签，但保留标签内的内容作为 data 属性传给 iframe (虽然 iframe 跨域读不到)
                            // 我们主要靠 postMessage 通信
                            const newHtml = html.replace(/&lt;fphone&gt;[\s\S]*?&lt;\/fphone&gt;|<fphone>[\s\S]*?<\/fphone>|&lt;fphone&gt;|<fphone>/g, iframe);
                            
                            if (html !== newHtml) {
                                $(this).html(newHtml);
                            }
                        }
                    });
                }
            });
        });
    });

    const chatTarget = document.querySelector('#chat');
    if (chatTarget) observer.observe(chatTarget, { childList: true, subtree: true });
}

// 注册插件
jQuery(async () => {
    if (!extension_settings[SETTINGS_KEY]) {
        extension_settings[SETTINGS_KEY] = DEFAULT_SETTINGS;
    }
    
    // 添加设置菜单
    const settingsHtml = `
        <div class="sillyphone-settings">
            <h3>SillyPhone Cloud 设置</h3>
            <label>小手机网址 (Cloudflare):</label>
            <input type="text" id="sillyphone_url" class="text_pole" value="${extension_settings[SETTINGS_KEY].phoneUrl}" />
            <button id="sillyphone_save" class="menu_button" style="margin-top:10px;">保存设置</button>
            <small>保存后刷新页面生效</small>
        </div>
    `;
    $('#extensions_settings').append(settingsHtml);
    
    $('#sillyphone_save').on('click', () => {
        extension_settings[SETTINGS_KEY].phoneUrl = $('#sillyphone_url').val();
        alert("设置已保存");
    });
    
    // 启动监听
    window.addEventListener('message', handlePhoneMessage);
    
    // 启动正则替换
    setTimeout(startTagObserver, 1000);
    
    console.log("[SillyPhone] 插件加载完成，等待连接...");
});
