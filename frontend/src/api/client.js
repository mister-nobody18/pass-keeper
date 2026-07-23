const BASE = '/api';

function getCookie(name) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
}

async function request(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (method !== 'GET') {
        const csrfToken = getCookie('csrfToken');
        if (csrfToken) headers['x-csrf-token'] = csrfToken;
    }

    const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        credentials: 'include',
        body: body ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try {
        data = await res.json();
    } catch {
        // e.g. 204 No Content
    }

    if (!res.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`);
    }
    return data;
}

export const api = {
    register: (email, password) => request('/auth/register', { method: 'POST', body: { email, password } }),
    login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
    logout: () => request('/auth/logout', { method: 'POST' }),
    me: () => request('/auth/me'),

    listEntries: () => request('/vault'),
    createEntry: (entry) => request('/vault', { method: 'POST', body: entry }),
    updateEntry: (id, entry) => request(`/vault/${id}`, { method: 'PUT', body: entry }),
    deleteEntry: (id) => request(`/vault/${id}`, { method: 'DELETE' }),

    changePassword: (currentPassword, newPassword) =>
        request('/settings/password', { method: 'PUT', body: { currentPassword, newPassword } }),
};
