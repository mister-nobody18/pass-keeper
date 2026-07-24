// Plain wire-format encoding helpers (ArrayBuffer/Uint8Array <-> base64).
// Not a cryptographic primitive - just a byte<->text format every app needs
// its own copy of - so writing this by hand is expected and fine.

export function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000; // process in chunks to avoid call-stack limits on large arrays
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

export function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
