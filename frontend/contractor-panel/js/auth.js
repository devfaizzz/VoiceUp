// Contractor Authentication Helper Functions

function getContractorToken() {
    return localStorage.getItem('contractor_token');
}

function getContractorUser() {
    try {
        return JSON.parse(localStorage.getItem('contractor_user'));
    } catch {
        return null;
    }
}

function saveContractorAuth(data) {
    localStorage.setItem('contractor_token', data.token);
    localStorage.setItem('contractor_user', JSON.stringify(data.contractor));
    if (data.refreshToken) {
        localStorage.setItem('contractor_refresh', data.refreshToken);
    }
}

function clearContractorAuth() {
    localStorage.removeItem('contractor_token');
    localStorage.removeItem('contractor_user');
    localStorage.removeItem('contractor_refresh');
}

function isContractorLoggedIn() {
    return !!(getContractorToken() && getContractorUser());
}

function contractorAuthHeader() {
    const token = getContractorToken();
    return token ? { 'Authorization': 'Bearer ' + token } : {};
}

function contractorLogout() {
    clearContractorAuth();
    window.location.href = '/contractor/login.html';
}

async function refreshContractorToken() {
    const refreshToken = localStorage.getItem('contractor_refresh');
    if (!refreshToken) {
        contractorLogout();
        return null;
    }

    try {
        const response = await fetch('/api/contractor/auth/refresh', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ refreshToken })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            localStorage.setItem('contractor_token', data.token);
            return data.token;
        } else {
            contractorLogout();
            return null;
        }
    } catch (error) {
        console.error('Token refresh error:', error);
        contractorLogout();
        return null;
    }
}

async function contractorFetch(url, options = {}) {
    const headers = {
        ...options.headers,
        ...contractorAuthHeader()
    };

    let response = await fetch(url, { ...options, headers });

    // If unauthorized, try refreshing token
    if (response.status === 401) {
        const newToken = await refreshContractorToken();
        if (newToken) {
            headers['Authorization'] = 'Bearer ' + newToken;
            response = await fetch(url, { ...options, headers });
        }
    }

    return response;
}
