/** Hands a text to the browser as a file download (a link click on an object URL); no-op without a document */
export function downloadText(text: string, fileName: string, mime = "text/csv;charset=utf-8", bom = ""): void {
    if (typeof document === "undefined") return;
    const url = URL.createObjectURL(new Blob([bom, text], { type: mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
