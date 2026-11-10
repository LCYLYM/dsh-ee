/**
 * 复制文本。Clipboard API 只在安全上下文（HTTPS/localhost）可用；
 * 局域网 HTTP 部署或权限被拒时回退到隐藏 textarea + execCommand。
 * 返回是否真正复制成功，调用方不要无条件提示“已复制”。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到下面的回退
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    area.style.top = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
