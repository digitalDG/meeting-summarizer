const STORAGE_KEY = "msumm-history";
const MAX_ENTRIES = 50;
function read() {
    if (typeof window === "undefined")
        return [];
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    }
    catch {
        return [];
    }
}
function write(entries) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}
export function loadHistory() {
    return read();
}
export function saveMeeting(entry) {
    const rest = read().filter((e) => e.id !== entry.id);
    write([entry, ...rest].slice(0, MAX_ENTRIES));
}
export function updateMeetingTitle(id, title) {
    write(read().map((e) => (e.id === id ? { ...e, title } : e)));
}
export function deleteMeeting(id) {
    write(read().filter((e) => e.id !== id));
}
export function exportHistoryAsJson() {
    const entries = read();
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meeting-history-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}
export function importHistoryFromJson(jsonText) {
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    }
    catch {
        throw new Error("Invalid JSON file");
    }
    if (!Array.isArray(parsed))
        throw new Error("Expected an array of meetings");
    const existing = read();
    const existingIds = new Set(existing.map((e) => e.id));
    const toAdd = parsed.filter((e) => typeof e === "object" && e !== null &&
        typeof e.id === "string" &&
        typeof e.title === "string" &&
        typeof e.timestamp === "number" &&
        e.summary != null &&
        !existingIds.has(e.id));
    write([...toAdd, ...existing]
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, MAX_ENTRIES));
    return { imported: toAdd.length, skipped: parsed.length - toAdd.length };
}
