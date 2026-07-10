const cryptoUtils = {
    async generateKeyPair() {
        return await window.crypto.subtle.generateKey(
            { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
            true, ["encrypt", "decrypt"]
        );
    },

    async exportKey(key) {
        const exported = await window.crypto.subtle.exportKey("jwk", key);
        return JSON.stringify(exported);
    },

    async importPublicKey(jwkString) {
        const jwk = JSON.parse(jwkString);
        return await window.crypto.subtle.importKey("jwk", jwk, { name: "RSA-OAEP", hash: "SHA-256" }, true, ["encrypt"]);
    },

    async importPrivateKey(jwkString) {
        const jwk = JSON.parse(jwkString);
        return await window.crypto.subtle.importKey("jwk", jwk, { name: "RSA-OAEP", hash: "SHA-256" }, true, ["decrypt"]);
    },

    // UPDATED: Now takes both recipient and sender public keys
    async encryptMessage(text, recipientPublicKeyJwk, senderPublicKeyJwk) {
        const recipientKey = await this.importPublicKey(recipientPublicKeyJwk);
        const senderKey = await this.importPublicKey(senderPublicKeyJwk);

        const aesKey = await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);

        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encodedText = new TextEncoder().encode(text);
        const encryptedText = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, encodedText);

        const exportedAesKey = await window.crypto.subtle.exportKey("raw", aesKey);

        // Encrypt the AES key for BOTH the recipient and the sender
        const encryptedKeyRecipient = await window.crypto.subtle.encrypt({ name: "RSA-OAEP" }, recipientKey, exportedAesKey);
        const encryptedKeySender = await window.crypto.subtle.encrypt({ name: "RSA-OAEP" }, senderKey, exportedAesKey);

        return {
            encryptedText: this.arrayBufferToBase64(encryptedText),
            encryptedKey: this.arrayBufferToBase64(encryptedKeyRecipient),
            encryptedKeySender: this.arrayBufferToBase64(encryptedKeySender), // NEW
            iv: this.arrayBufferToBase64(iv)
        };
    },

    // UPDATED: Tries recipient key first, then falls back to sender key
    async decryptMessage(payload, privateKeyJwk) {
        const privateKey = await this.importPrivateKey(privateKeyJwk);
        let aesKeyRaw;

        try {
            // Try decrypting with the main key (usually the recipient)
            aesKeyRaw = await window.crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, this.base64ToArrayBuffer(payload.encryptedKey));
        } catch (err) {
            // If that fails, try the sender's key (if we are the sender reading our own message)
            if (payload.encryptedKeySender) {
                aesKeyRaw = await window.crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, this.base64ToArrayBuffer(payload.encryptedKeySender));
            } else {
                throw err;
            }
        }

        const aesKey = await window.crypto.subtle.importKey("raw", aesKeyRaw, { name: "AES-GCM" }, true, ["decrypt"]);
        const encryptedText = this.base64ToArrayBuffer(payload.encryptedText);
        const iv = this.base64ToArrayBuffer(payload.iv);
        const decryptedText = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, encryptedText);

        return new TextDecoder().decode(decryptedText);
    },

    arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        return window.btoa(binary);
    },

    base64ToArrayBuffer(base64) {
        const binary_string = window.atob(base64);
        const len = binary_string.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary_string.charCodeAt(i);
        return bytes.buffer;
    }
};