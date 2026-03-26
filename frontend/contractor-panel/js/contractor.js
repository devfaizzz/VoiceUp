// VoiceUp Contractor Dashboard JS

// Check auth on load
if (!isContractorLoggedIn()) {
    window.location.href = '/contractor/login.html';
}

// Page titles
const pageTitles = {
    'dashboard': { title: 'Dashboard', subtitle: 'Overview of your contractor activities' },
    'available': { title: 'Available Issues', subtitle: 'Browse and bid on available civic issues' },
    'my-bids': { title: 'My Bids', subtitle: 'Track all your submitted bids' },
    'projects': { title: 'Active Projects', subtitle: 'Manage your ongoing projects' },
    'completed': { title: 'Completed', subtitle: 'View your completed projects and payments' }
};

// Socket.io connection
let socket;
function initSocket() {
    socket = io();
    
    // Join contractor room on connect
    socket.on('connect', () => {
        const user = getContractorUser();
        if (user?.id) {
            socket.emit('join-contractor-room', user.id);
        }
    });
    
    socket.on('new_report_request', (data) => {
        showToast(`🔔 New issue available: ${data.title || 'New Report'}`, 'info');
        if (document.getElementById('page-available').classList.contains('active')) {
            loadAvailableIssues();
        }
        loadDashboardStats();
    });

    socket.on('bid_accepted', (data) => {
        showToast(`🎉 ${data.message || 'Congratulations! Your bid has been accepted!'}`, 'success');
        showCongratsBanner();
        loadDashboardStats();
        loadMyBids();
        loadActiveProjects();
    });

    // Legacy event names for backward compatibility
    socket.on('issue:sent-to-contractors', (data) => {
        showToast('New issue available for bidding!', 'info');
        if (document.getElementById('page-available').classList.contains('active')) {
            loadAvailableIssues();
        }
        loadDashboardStats();
    });

    socket.on('bid:accepted', (data) => {
        const user = getContractorUser();
        if (data.contractorId === user?.id) {
            showToast('🎉 Congratulations! Your bid has been accepted!', 'success');
            showCongratsBanner();
            loadDashboardStats();
            loadMyBids();
            loadActiveProjects();
        }
    });

    socket.on('bid:new', (data) => {
        loadDashboardStats();
    });
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    initSocket();
    loadUserInfo();
    loadDashboardStats();
    setMinDate();
    setupFileInputs();
});

// Load user info
function loadUserInfo() {
    const user = getContractorUser();
    if (user) {
        document.getElementById('userName').textContent = user.name || 'Contractor';
        const initials = (user.name || 'C').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
        document.getElementById('userAvatar').textContent = initials;
    }
}

// Page navigation
function showPage(page, el) {
    if (event) event.preventDefault();

    document.querySelectorAll('.page-section').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + page)?.classList.add('active');

    document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));
    if (el) el.classList.add('active');

    const info = pageTitles[page] || {};
    document.getElementById('pageTitle').textContent = info.title || page;
    document.getElementById('pageSubtitle').textContent = info.subtitle || '';

    // Load page data
    if (page === 'dashboard') loadDashboardStats();
    if (page === 'available') loadAvailableIssues();
    if (page === 'my-bids') loadMyBids();
    if (page === 'projects') loadActiveProjects();
    if (page === 'completed') loadCompletedProjects();
}

// Dashboard stats
async function loadDashboardStats() {
    try {
        const response = await contractorFetch('/api/contractor/dashboard-stats');
        const data = await parseResponseSafe(response);

        if (data.success) {
            document.getElementById('statTotalBids').textContent = data.stats.totalBids || 0;
            document.getElementById('statAccepted').textContent = data.stats.acceptedBids || 0;
            document.getElementById('statCompleted').textContent = data.stats.completedProjects || 0;
            document.getElementById('statRating').textContent = (data.stats.averageRating || 0).toFixed(1);

            // Recent activity
            const tbody = document.getElementById('recentActivityTable');
            if (data.recentBids && data.recentBids.length > 0) {
                tbody.innerHTML = data.recentBids.map(bid => `
                    <tr>
                        <td>${bid.issue?.title || 'N/A'}</td>
                        <td><span class="issue-category">${bid.issue?.category || 'N/A'}</span></td>
                        <td>₹${bid.bidAmount?.toLocaleString() || 0}</td>
                        <td><span class="bid-status bid-${bid.status}">${bid.status}</span></td>
                        <td>${new Date(bid.createdAt).toLocaleDateString()}</td>
                    </tr>
                `).join('');
            } else {
                tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No recent activity</td></tr>';
            }

            // Check for active projects
            if (data.stats.activeProjects > 0) {
                if (!sessionStorage.getItem('congratsShown')) {
                    showCongratsBanner();
                    sessionStorage.setItem('congratsShown', 'true');
                }
            }
        }
    } catch (error) {
        console.error('Load dashboard error:', error);
    }
}

// Format timestamp helper
function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
}

// Get status tag HTML
function getStatusTag(issue) {
    if (issue.hasBid) {
        const statusClass = issue.bidStatus === 'accepted' ? 'accepted' 
                          : issue.bidStatus === 'rejected' ? 'rejected' 
                          : 'bid-placed';
        const statusText = issue.bidStatus === 'accepted' ? 'Accepted'
                         : issue.bidStatus === 'rejected' ? 'Rejected'
                         : 'Bid Placed';
        return `<span class="status-tag ${statusClass}">${statusText}</span>`;
    }
    return '<span class="status-tag pending">Open for Bids</span>';
}

function isPendingAdminVerification(bid) {
    return bid?.status === 'completed'
        && bid?.workProof?.afterImages?.length > 0
        && bid?.workProof?.adminReview?.status !== 'verified'
        && !['payment_pending', 'paid'].includes(bid?.issue?.contractorAssignment?.status);
}

function getProjectPhaseLabel(bid) {
    if (isPendingAdminVerification(bid)) return 'Pending Admin Verification';
    if (bid?.issue?.contractorAssignment?.status === 'payment_pending') return 'Admin Verified';
    if (bid?.status === 'payment_requested') return 'Payment Requested';
    if (bid?.status === 'paid' || bid?.issue?.contractorAssignment?.status === 'paid') return 'Paid';
    if (bid?.status === 'work_in_progress') return 'Work In Progress';
    if (bid?.status === 'accepted') return 'Accepted';
    return bid?.status || 'Unknown';
}

function isArchivedCompletedProject(bid) {
    return ['payment_requested', 'paid'].includes(bid?.status)
        || ['payment_pending', 'paid'].includes(bid?.issue?.contractorAssignment?.status)
        || (bid?.status === 'completed' && bid?.workProof?.adminReview?.status === 'verified');
}

// Available issues
async function loadAvailableIssues() {
    const grid = document.getElementById('availableIssuesGrid');
    grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><p>Loading...</p></div>';

    try {
        const response = await contractorFetch('/api/contractor/available-issues');
        const data = await parseResponseSafe(response);

        if (data.success && data.issues.length > 0) {
            grid.innerHTML = data.issues.map(issue => `
                <div class="issue-card">
                    <img class="issue-image" src="${issue.images?.[0]?.url || '/images/placeholder.png'}" alt="${issue.title}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23f1f5f9%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2250%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2230%22>📷</text></svg>'">
                    <div class="issue-content">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                            <span class="issue-category">${getCategoryIcon(issue.category)} ${issue.category}</span>
                            ${getStatusTag(issue)}
                        </div>
                        <h4 class="issue-title">${issue.title}</h4>
                        <p class="issue-location">📍 ${issue.location?.address || 'Location not specified'}</p>
                        <p class="issue-timestamp">🕐 Sent ${formatTimeAgo(issue.contractorAssignment?.sentAt || issue.createdAt)}</p>
                        <div class="issue-meta" style="margin-top:12px;">
                            <span class="priority-badge priority-${issue.priority}">${issue.priority}</span>
                        </div>
                        <div style="margin-top:12px;display:flex;gap:8px;">
                            <button class="btn btn-outline btn-sm" onclick="viewIssueDetails('${issue._id}')">View Details</button>
                            ${!issue.hasBid 
                                ? `<button class="btn btn-primary btn-sm" onclick="openBidModal('${issue._id}')">Place Bid</button>`
                                : ''
                            }
                        </div>
                    </div>
                </div>
            `).join('');
        } else {
            grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p>No issues available for bidding at the moment.</p></div>';
        }
    } catch (error) {
        console.error('Load available issues error:', error);
        grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div><p>Error loading issues. Please try again.</p></div>';
    }
}

// My bids
async function loadMyBids() {
    const tbody = document.getElementById('myBidsTable');
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Loading...</td></tr>';

    const status = document.getElementById('bidStatusFilter')?.value || '';

    try {
        const response = await contractorFetch(`/api/contractor/my-bids?status=${status}`);
        const data = await parseResponseSafe(response);

        if (data.success && data.bids.length > 0) {
            tbody.innerHTML = data.bids.map(bid => `
                <tr>
                    <td>${bid.issue?.title || 'N/A'}</td>
                    <td><span class="issue-category">${bid.issue?.category || 'N/A'}</span></td>
                    <td>₹${bid.bidAmount?.toLocaleString()}</td>
                    <td>${bid.completionDays} days</td>
                    <td>${new Date(bid.completionDeadline).toLocaleDateString()}</td>
                    <td><span class="bid-status bid-${bid.status}">${bid.status}</span></td>
                    <td>
                        ${bid.status === 'accepted' ? `<button class="btn btn-primary btn-sm" onclick="startWork('${bid._id}')">Start Work</button>` : ''}
                        ${bid.status === 'work_in_progress' ? `<button class="btn btn-success btn-sm" onclick="openWorkModal('${bid._id}')">Complete</button>` : ''}
                        ${bid.status === 'completed' ? `<button class="btn btn-primary btn-sm" onclick="openPaymentModal('${bid._id}')">Request Payment</button>` : ''}
                    </td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No bids found</td></tr>';
        }
    } catch (error) {
        console.error('Load bids error:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Error loading bids</td></tr>';
    }
}

// Active projects
async function loadActiveProjects() {
    const container = document.getElementById('activeProjectsList');
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><p>Loading...</p></div>';

    try {
        const response = await contractorFetch('/api/contractor/accepted-bids');
        const data = await parseResponseSafe(response);

        const activeProjects = data.bids?.filter(b => ['accepted', 'work_in_progress'].includes(b.status) || isPendingAdminVerification(b)) || [];

        if (activeProjects.length > 0) {
            container.innerHTML = activeProjects.map(bid => `
                <div class="glass-card" style="margin-bottom:16px;">
                    <div class="card-body">
                        <div style="display:flex;justify-content:space-between;align-items:start;">
                            <div>
                                <h4 style="margin-bottom:8px;">${bid.issue?.title || 'N/A'}</h4>
                                <p style="color:#64748b;font-size:14px;margin-bottom:8px;">📍 ${bid.issue?.location?.address || 'N/A'}</p>
                                <div style="display:flex;gap:12px;font-size:14px;color:#64748b;">
                                    <span>💰 ₹${bid.bidAmount?.toLocaleString()}</span>
                                    <span>📅 ${bid.completionDays} days</span>
                                    <span>⏰ Deadline: ${new Date(bid.completionDeadline).toLocaleDateString()}</span>
                                </div>
                                ${isPendingAdminVerification(bid) ? `
                                    <div style="margin-top:10px;padding:10px 12px;border-radius:10px;background:#eff6ff;color:#1d4ed8;font-size:13px;font-weight:600;">
                                        Work submitted. Waiting for admin verification.
                                    </div>
                                ` : ''}
                            </div>
                            <div style="text-align:right;">
                                <span class="bid-status bid-${bid.status}">${getProjectPhaseLabel(bid)}</span>
                                <div style="margin-top:12px;">
                                    ${bid.status === 'accepted' ? `<button class="btn btn-primary btn-sm" onclick="startWork('${bid._id}')">🔧 Start Work</button>` : ''}
                                    ${bid.status === 'work_in_progress' ? `<button class="btn btn-success btn-sm" onclick="openWorkModal('${bid._id}')">✓ Mark Complete</button>` : ''}
                                    ${isPendingAdminVerification(bid) ? `<span style="display:inline-block;color:#64748b;font-size:13px;font-weight:600;">Admin review pending</span>` : ''}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔧</div><p>No active projects. Win bids to start working!</p></div>';
        }
    } catch (error) {
        console.error('Load active projects error:', error);
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div><p>Error loading projects</p></div>';
    }
}

// Completed projects
async function loadCompletedProjects() {
    const tbody = document.getElementById('completedProjectsTable');
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Loading...</td></tr>';

    try {
        const response = await contractorFetch('/api/contractor/accepted-bids');
        const data = await parseResponseSafe(response);

        const completedProjects = data.bids?.filter(isArchivedCompletedProject) || [];

        if (completedProjects.length > 0) {
            tbody.innerHTML = completedProjects.map(bid => `
                <tr>
                    <td>${bid.issue?.title || 'N/A'}</td>
                    <td><span class="issue-category">${bid.issue?.category || 'N/A'}</span></td>
                    <td>₹${bid.bidAmount?.toLocaleString()}</td>
                    <td>${bid.workProof?.submittedAt ? new Date(bid.workProof.submittedAt).toLocaleDateString() : 'N/A'}</td>
                    <td>
                        <span class="bid-status bid-${bid.status}">
                            ${getProjectPhaseLabel(bid)}
                        </span>
                        ${bid.issue?.contractorAssignment?.status === 'payment_pending' || bid.status === 'completed'
                            ? `<button class="btn btn-primary btn-sm" style="margin-left:8px;" onclick="openPaymentModal('${bid._id}')">Request</button>`
                            : ''
                        }
                    </td>
                    <td>${bid.rating?.score ? `⭐ ${bid.rating.score}/5` : 'Not rated'}</td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No completed projects yet</td></tr>';
        }
    } catch (error) {
        console.error('Load completed projects error:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Error loading projects</td></tr>';
    }
}

// Bid Modal
function openBidModal(issueId) {
    document.getElementById('bidIssueId').value = issueId;
    document.getElementById('bidForm').reset();
    document.getElementById('bidError').classList.add('hidden');
    
    // Reset to form state
    document.getElementById('bidFormState').style.display = 'block';
    document.getElementById('bidSuccessState').style.display = 'none';
    
    document.getElementById('bidModal').classList.add('show');
    
    // Load issue details
    loadIssueDetails(issueId);
}

function closeBidModal() {
    document.getElementById('bidModal').classList.remove('show');
    
    // Reset states after modal closes
    setTimeout(() => {
        document.getElementById('bidFormState').style.display = 'block';
        document.getElementById('bidSuccessState').style.display = 'none';
    }, 300);
}

function showBidSuccessState() {
    document.getElementById('bidFormState').style.display = 'none';
    document.getElementById('bidSuccessState').style.display = 'block';
}

async function loadIssueDetails(issueId) {
    const container = document.getElementById('bidIssueDetails');
    try {
        const response = await fetch(`/api/issues/public/${issueId}`);
        const data = await parseResponseSafe(response);
        
        if (data) {
            container.innerHTML = `
                <h4 style="margin-bottom:8px;">${data.title}</h4>
                <p style="font-size:13px;color:#64748b;margin-bottom:4px;">📍 ${data.location?.address || 'N/A'}</p>
                <div style="display:flex;gap:8px;">
                    <span class="issue-category">${data.category}</span>
                    <span class="priority-badge priority-${data.priority}">${data.priority}</span>
                </div>
            `;
        }
    } catch (error) {
        container.innerHTML = '<p>Error loading issue details</p>';
    }
}

// View issue details (opens issue detail modal)
async function viewIssueDetails(issueId) {
    try {
        const response = await fetch(`/api/issues/public/${issueId}`);
        const issue = await response.json();
        
        if (issue) {
            // Create a simple detail modal
            const existingModal = document.getElementById('issueDetailModal');
            if (existingModal) existingModal.remove();
            
            const modalHtml = `
                <div id="issueDetailModal" class="modal-overlay show">
                    <div class="modal-content" style="max-width:600px;">
                        <div class="modal-header">
                            <h3>Issue Details</h3>
                            <button type="button" class="modal-close" onclick="closeIssueDetailModal()">&times;</button>
                        </div>
                        <div style="margin-bottom:16px;">
                            ${issue.images?.[0]?.url 
                                ? `<img src="${issue.images[0].url}" alt="${issue.title}" style="width:100%;max-height:200px;object-fit:cover;border-radius:8px;margin-bottom:16px;">`
                                : ''
                            }
                            <h4 style="margin-bottom:8px;font-size:18px;">${issue.title}</h4>
                            <p style="color:var(--text-secondary);margin-bottom:12px;">${issue.description || 'No description provided.'}</p>
                            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
                                <span class="issue-category">${getCategoryIcon(issue.category)} ${issue.category}</span>
                                <span class="priority-badge priority-${issue.priority}">${issue.priority}</span>
                            </div>
                            <p style="font-size:13px;color:var(--text-muted);margin-bottom:8px;">📍 ${issue.location?.address || 'Location not specified'}</p>
                            <p style="font-size:13px;color:var(--text-muted);">📅 Reported: ${new Date(issue.createdAt).toLocaleDateString()}</p>
                        </div>
                        <div style="display:flex;gap:12px;">
                            <button type="button" class="btn btn-outline" style="flex:1;" onclick="closeIssueDetailModal()">Close</button>
                            <button type="button" class="btn btn-primary" style="flex:1;" onclick="closeIssueDetailModal(); openBidModal('${issue._id}');">Place Bid</button>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.insertAdjacentHTML('beforeend', modalHtml);
        }
    } catch (error) {
        showToast('Failed to load issue details', 'error');
    }
}

function closeIssueDetailModal() {
    const modal = document.getElementById('issueDetailModal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 300);
    }
}

// Submit bid
let isSubmittingBid = false;

document.getElementById('bidForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Prevent duplicate submissions
    if (isSubmittingBid) return;
    
    const btn = document.getElementById('submitBidBtn');
    const errorDiv = document.getElementById('bidError');
    
    // Get form values
    const bidAmount = document.getElementById('bidAmount').value;
    const completionDays = document.getElementById('bidDays').value;
    const completionDeadline = document.getElementById('bidDeadline').value;
    
    // Validate inputs
    if (!bidAmount || parseFloat(bidAmount) <= 0) {
        errorDiv.textContent = 'Please enter a valid bid amount greater than 0';
        errorDiv.classList.remove('hidden');
        return;
    }
    
    if (!completionDays || parseInt(completionDays) <= 0) {
        errorDiv.textContent = 'Please enter valid number of days';
        errorDiv.classList.remove('hidden');
        return;
    }
    
    if (!completionDeadline) {
        errorDiv.textContent = 'Please select a completion deadline';
        errorDiv.classList.remove('hidden');
        return;
    }
    
    const deadlineDate = new Date(completionDeadline);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (deadlineDate <= today) {
        errorDiv.textContent = 'Completion deadline must be a future date';
        errorDiv.classList.remove('hidden');
        return;
    }
    
    isSubmittingBid = true;
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    errorDiv.classList.add('hidden');

    try {
        const response = await contractorFetch('/api/contractor/bid', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                issueId: document.getElementById('bidIssueId').value,
                bidAmount: bidAmount,
                completionDays: completionDays,
                completionDeadline: completionDeadline,
                rawMaterialCost: document.getElementById('rawMaterialCost')?.value || 0
            })
        });

        const data = await response.json();

        if (data.success) {
            // Show success state in modal
            showBidSuccessState();
            
            // Refresh data in background
            loadAvailableIssues();
            loadDashboardStats();
        } else {
            throw new Error(data.message || 'Failed to submit bid');
        }
    } catch (error) {
        errorDiv.textContent = error.message;
        errorDiv.classList.remove('hidden');
    } finally {
        isSubmittingBid = false;
        btn.disabled = false;
        btn.textContent = 'Submit Bid';
    }
});

// Start work
async function startWork(bidId) {
    try {
        const response = await contractorFetch(`/api/contractor/bid/${bidId}/start-work`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            showToast('Work started! Good luck!', 'success');
            loadMyBids();
            loadActiveProjects();
        } else {
            throw new Error(data.message);
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Work completion modal
function openWorkModal(bidId) {
    document.getElementById('workBidId').value = bidId;
    document.getElementById('workForm').reset();
    document.getElementById('beforePreview').innerHTML = '';
    document.getElementById('afterPreview').innerHTML = '';
    document.getElementById('workError').classList.add('hidden');
    document.getElementById('workModal').classList.add('show');
}

function closeWorkModal() {
    document.getElementById('workModal').classList.remove('show');
}

// Setup file inputs for preview
function setupFileInputs() {
    document.getElementById('beforeImages')?.addEventListener('change', (e) => {
        previewFiles(e.target.files, 'beforePreview');
    });
    
    document.getElementById('afterImages')?.addEventListener('change', (e) => {
        previewFiles(e.target.files, 'afterPreview');
    });
}

function previewFiles(files, containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = document.createElement('img');
            img.src = e.target.result;
            container.appendChild(img);
        };
        reader.readAsDataURL(file);
    });
}

// Submit work completion
document.getElementById('workForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const btn = document.getElementById('submitWorkBtn');
    const errorDiv = document.getElementById('workError');
    
    const afterImages = document.getElementById('afterImages').files;
    if (afterImages.length === 0) {
        errorDiv.textContent = 'Please upload at least one after image';
        errorDiv.classList.remove('hidden');
        return;
    }
    
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    errorDiv.classList.add('hidden');

    try {
        // Get current location
        const position = await getCurrentPosition();
        
        const formData = new FormData();
        
        const beforeImages = document.getElementById('beforeImages').files;
        Array.from(beforeImages).forEach(file => {
            formData.append('beforeImages', file);
        });
        
        Array.from(afterImages).forEach(file => {
            formData.append('afterImages', file);
        });
        
        formData.append('notes', document.getElementById('workNotes').value);
        formData.append('latitude', position.coords.latitude);
        formData.append('longitude', position.coords.longitude);

        const response = await contractorFetch(`/api/contractor/bid/${document.getElementById('workBidId').value}/complete`, {
            method: 'POST',
            body: formData
        });

        const data = await parseResponseSafe(response);

        if (data.success) {
            showToast('Work submitted. Pending admin verification.', 'success');
            closeWorkModal();
            loadDashboardStats();
            loadActiveProjects();
            loadCompletedProjects();
        } else {
            throw new Error(data.message || 'Failed to submit work');
        }
    } catch (error) {
        errorDiv.textContent = error.message;
        errorDiv.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = '✓ Complete Work';
    }
});

// Payment modal
function openPaymentModal(bidId) {
    document.getElementById('paymentBidId').value = bidId;
    document.getElementById('paymentLocationStatus').textContent = 'Click the button below to verify your location.';
    document.getElementById('paymentError').classList.add('hidden');
    document.getElementById('verifyPaymentBtn').disabled = false;
    document.getElementById('paymentModal').classList.add('show');
}

function closePaymentModal() {
    document.getElementById('paymentModal').classList.remove('show');
}

// Request payment with location verification
async function requestPaymentWithLocation() {
    const btn = document.getElementById('verifyPaymentBtn');
    const statusDiv = document.getElementById('paymentLocationStatus');
    const errorDiv = document.getElementById('paymentError');
    
    btn.disabled = true;
    btn.textContent = '📍 Getting location...';
    errorDiv.classList.add('hidden');

    try {
        const position = await getCurrentPosition();
        
        statusDiv.innerHTML = `<span style="color:#10b981;">✓ Location captured</span><br>Lat: ${position.coords.latitude.toFixed(6)}, Lng: ${position.coords.longitude.toFixed(6)}`;
        btn.textContent = '⏳ Verifying...';

        const response = await contractorFetch(`/api/contractor/bid/${document.getElementById('paymentBidId').value}/request-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
            })
        });

        const data = await response.json();

        if (data.success) {
            showToast('Payment request submitted!', 'success');
            closePaymentModal();
            loadCompletedProjects();
        } else {
            throw new Error(data.message || 'Payment request failed');
        }
    } catch (error) {
        errorDiv.textContent = error.message;
        errorDiv.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = '📍 Verify Location & Request Payment';
    }
}

// Helper functions
function getCurrentPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation is not supported'));
            return;
        }
        
        navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 30000,
            maximumAge: 10000
        });
    });
}

function setMinDate() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const minDate = tomorrow.toISOString().split('T')[0];
    document.getElementById('bidDeadline')?.setAttribute('min', minDate);
}

function getCategoryIcon(category) {
    const icons = {
        pothole: '🛣️',
        streetlight: '💡',
        garbage: '🗑️',
        water: '💧',
        sewage: '🚿',
        traffic: '🚦',
        other: '📌'
    };
    return icons[category?.toLowerCase()] || '📌';
}

function showCongratsBanner() {
    document.getElementById('congratsBanner')?.classList.remove('hidden');
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span style="font-size:20px;">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ️'}</span>
        <span>${message}</span>
    `;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideUp 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

async function parseResponseSafe(response) {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        return { message: text };
    }
}
