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
