/**
 * auth.js — shared authentication utility for the citizen panel.
 * Include this script BEFORE app.js in any page that needs auth.
 */

function getToken() {
    return localStorage.getItem('voiceup_token');
}

function getUser() {
    try {
        return JSON.parse(localStorage.getItem('voiceup_user'));
    } catch { return null; }
}

function saveAuth(data) {
    localStorage.setItem('voiceup_token', data.token);
    localStorage.setItem('voiceup_user', JSON.stringify(data.user));
    if (data.refreshToken) {
        localStorage.setItem('voiceup_refresh', data.refreshToken);
    }
}

function clearAuth() {
    localStorage.removeItem('voiceup_token');
    localStorage.removeItem('voiceup_user');
    localStorage.removeItem('voiceup_refresh');
}

function isLoggedIn() {
    return !!(getToken() && getUser());
}

function authHeader() {
    const token = getToken();
    return token ? { 'Authorization': 'Bearer ' + token } : {};
}

function logout() {
    clearAuth();
    window.location.href = '/login.html';
}

async function refreshAuthToken() {
    const refreshToken = localStorage.getItem('voiceup_refresh');
    if (!refreshToken) {
        clearAuth();
        return null;
    }

    try {
        const response = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken })
        });

        const data = await response.json();
        if (response.ok && data.token) {
            localStorage.setItem('voiceup_token', data.token);
            return data.token;
        }
    } catch (error) {
        console.error('Citizen token refresh failed:', error);
    }

    clearAuth();
    return null;
}

async function authFetch(url, options = {}) {
    const headers = {
        ...options.headers,
        ...authHeader()
    };

    let response = await fetch(url, { ...options, headers });

    if (response.status === 401 || response.status === 403) {
        const newToken = await refreshAuthToken();
        if (newToken) {
            headers.Authorization = 'Bearer ' + newToken;
            response = await fetch(url, { ...options, headers });
        }
    }

    return response;
}
