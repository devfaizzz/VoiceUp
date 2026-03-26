// VoiceUp Admin Panel — Enhanced JS
// Google Maps Integration
let adminMap;
let issueMarkers = [];
let infoWindow;

// Auth helper
function adminAuthHeader() {
  const t = localStorage.getItem('voiceup_admin_token');
  return t ? { 'Authorization': 'Bearer ' + t } : {};
}

function clearAdminAuth() {
  localStorage.removeItem('voiceup_admin_token');
}

async function refreshAdminToken() {
  const refreshToken = localStorage.getItem('voiceup_admin_refresh');
  if (!refreshToken) return null;

  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      localStorage.setItem('voiceup_admin_token', data.token);
      return data.token;
    }
  } catch (e) {
    console.error('Admin token refresh failed:', e);
  }

  return null;
}

async function adminFetch(url, options = {}) {
  const headers = {
    ...options.headers,
    ...adminAuthHeader()
  };

  let res = await fetch(url, { ...options, headers });

  if (res.status === 401 || res.status === 403) {
    const token = await refreshAdminToken();
    if (token) {
      headers.Authorization = 'Bearer ' + token;
      res = await fetch(url, { ...options, headers });
    }
  }

  return res;
}

// ── Profile Dropdown Toggle ──
function setupAdminProfileDropdown() {
  const profileBtn = document.getElementById('userProfileBtn');
  const dropdown = document.getElementById('adminProfDrop');
  const logoutBtn = document.getElementById('adminLogoutDropdownBtn');

  console.log('Setting up admin dropdown:', { profileBtn: !!profileBtn, dropdown: !!dropdown, logoutBtn: !!logoutBtn });

  if (!profileBtn || !dropdown) {
    console.warn('Admin dropdown setup failed - missing elements');
    return;
  }

  // Toggle dropdown on profile button click
  profileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('show');
    console.log('Admin dropdown toggled, now has show class:', dropdown.classList.contains('show'));
  });

  // Handle logout button click
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearAdminAuth();
      window.location.href = '/admin';
    });
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (dropdown.classList.contains('show')) {
      if (!e.target.closest('.header-right')) {
        dropdown.classList.remove('show');
      }
    }
  });
}

// Initialize on DOM ready or immediately if already loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupAdminProfileDropdown);
} else {
  setupAdminProfileDropdown();
}

// All issues cache
let allIssues = [];

// Pagination state
let currentPage = 1;
let pageSize = 10;
let issuesCurrentPage = 1;

// ── Socket.io ──
let socket;
function initAdminSocket() {
  socket = io();

  // Join admin room on connect
  socket.on('connect', () => {
    socket.emit('join-admin-room');
  });

  socket.on('admin:reminder', data => {
    // Show a modern notification/alert
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed; top:24px; right:24px; background:white; padding:16px 20px; border-radius:12px; box-shadow:0 10px 25px rgba(0,0,0,0.1); border-left:4px solid var(--accent); z-index:9999; display:flex; gap:12px; align-items:center; animation: slideIn 0.3s ease-out;';
    toast.innerHTML = `
      <div style="font-size:24px;">🔔</div>
      <div>
        <div style="font-weight:700; color:var(--text-main); margin-bottom:2px;">New Reminder!</div>
        <div style="font-size:13px; color:var(--text-muted);">${data.message}</div>
      </div>
    `;
    document.body.appendChild(toast);

    // Play sound if possible or just show badge
    const badge = document.querySelector('.notification-badge');
    if (badge) {
      const count = parseInt(badge.textContent) || 0;
      badge.textContent = count + 1;
      badge.style.display = 'flex';
    }

    setTimeout(() => {
      toast.style.animation = 'fadeOut 0.3s ease-in forwards';
      setTimeout(() => toast.remove(), 300);
    }, 6000);

    // Refresh issues list if on dashboard or issues page
    loadAll();
  });

  socket.on('issue:updated', () => loadAll());

  // New bid received notification
  socket.on('bid:new', (data) => {
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed; top:24px; right:24px; background:white; padding:16px 20px; border-radius:12px; box-shadow:0 10px 25px rgba(0,0,0,0.1); border-left:4px solid #6366f1; z-index:9999; display:flex; gap:12px; align-items:center; animation: slideIn 0.3s ease-out;';
    toast.innerHTML = `
      <div style="font-size:24px;">🏗️</div>
      <div>
        <div style="font-weight:700; color:var(--text-main); margin-bottom:2px;">New Bid Received!</div>
        <div style="font-size:13px; color:var(--text-muted);">${data.contractorName} bid ₹${data.bidAmount?.toLocaleString()} for ${data.completionDays} days</div>
      </div>
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'fadeOut 0.3s ease-in forwards';
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  });

  // Work completed notification
  socket.on('work:completed', (data) => {
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed; top:24px; right:24px; background:white; padding:16px 20px; border-radius:12px; box-shadow:0 10px 25px rgba(0,0,0,0.1); border-left:4px solid #10b981; z-index:9999; display:flex; gap:12px; align-items:center; animation: slideIn 0.3s ease-out;';
    toast.innerHTML = `
      <div style="font-size:24px;">✅</div>
      <div>
        <div style="font-weight:700; color:var(--text-main); margin-bottom:2px;">Work Completed!</div>
        <div style="font-size:13px; color:var(--text-muted);">${data.contractorName} has submitted work completion proof</div>
      </div>
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'fadeOut 0.3s ease-in forwards';
      setTimeout(() => toast.remove(), 300);
    }, 5000);
    loadAll();
  });
}

// ── Page Navigation ──
// Called on sidebar link click — switches visible page section
function showPage(page, el) {
  // Prevent default href navigation
  if (event) { event.preventDefault(); }

  // Hide all pages
  document.querySelectorAll('.page-section').forEach(p => p.classList.remove('active'));

  // Show target page
  const target = document.getElementById('page-' + page);
  if (target) target.classList.add('active');

  // Update sidebar active state
  document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));
  if (el) el.classList.add('active');

  // Update header title/subtitle
  const pageTitles = {
    'dashboard': { title: 'Dashboard', subtitle: 'Overview of all reported issues' },
    'issues': { title: 'Issues', subtitle: 'Manage and review reported issues' },
    'map-view': { title: 'Map View', subtitle: 'Geographic view of all reports' },
    'departments': { title: 'Departments', subtitle: 'Manage and organize departments' },
    'analytics': { title: 'Analytics', subtitle: 'Track and analyze issue reports' },
    'reports': { title: 'Reports', subtitle: 'Generate and export detailed reports' },
    'sentiment': { title: 'Sentiment Analysis', subtitle: 'Review issue mood, negative share, and area trends' },
    'settings': { title: 'Settings', subtitle: 'Configure admin panel preferences' }
  };
  const info = pageTitles[page] || {};
  const titleEl = document.getElementById('headerPageTitle');
  const subtitleEl = document.getElementById('headerPageSubtitle');
  if (titleEl) titleEl.textContent = info.title || page;
  if (subtitleEl) subtitleEl.textContent = info.subtitle || '';

  // Trigger map resize if switching to map view
  if (page === 'map-view' && typeof google !== 'undefined' && adminMap) {
    setTimeout(() => google.maps.event.trigger(adminMap, 'resize'), 200);
  }

  // Re-draw charts on analytics page
  if (page === 'analytics') {
    setTimeout(initCharts, 100);
  }

  if (page === 'sentiment' && typeof window.loadSentimentData === 'function') {
    window.loadSentimentData();
  }

  // Render issues page table
  if (page === 'issues') {
    renderIssuesPage();
  }

  // Render reports page
  if (page === 'reports') {
    renderReports();
  }

  return false;
}

function closeModal() {
  document.getElementById('issueModal').classList.remove('show');
}

// ── Stats Update ──
function updateStats() {
  const total = allIssues.length;
  const hold = allIssues.filter(i => i.status === 'hold' || i.status === 'new').length;
  const approved = allIssues.filter(i => i.status === 'approved').length;
  const rejected = allIssues.filter(i => i.status === 'rejected').length;

  animateNumber('statTotal', total);
  animateNumber('statPending', hold);
  animateNumber('statApproved', approved);
  animateNumber('statRejected', rejected);

  // Analytics mini-stats
  setValue('analyticsTotal', total);
  setValue('analyticsApproved', approved);
  setValue('analyticsRejected', rejected);
  setValue('analyticsHold', hold);
}

function animateNumber(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  if (start === target) { el.textContent = target; return; }
  const duration = 600;
  const startTime = performance.now();
  const tick = (now) => {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function setValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── CSV Export (restored original filename format) ──
function exportCSV() {
  if (allIssues.length === 0) {
    alert('No data to export');
    return;
  }

  const headers = ['ID', 'Category', 'Title', 'Location', 'Priority', 'Status', 'Created At'];
  const rows = allIssues.map(i => [
    i._id,
    i.category,
    '"' + (i.title || '').replace(/"/g, '""') + '"',
    '"' + (i.location?.address || '').replace(/"/g, '""') + '"',
    i.priority,
    i.status,
    new Date(i.createdAt).toLocaleString()
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;

  // Use setAttribute for robust filename assignment
  const filename = `voiceup_report_${new Date().toISOString().slice(0, 10)}.csv`;
  a.setAttribute('download', filename);
  a.download = filename;

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Give browser 500ms to register download intent
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

// ── Google Maps ──
function initAdminMap() {
  const defaultLocation = { lat: 28.6139, lng: 77.2090 };

  adminMap = new google.maps.Map(document.getElementById('adminMap'), {
    center: defaultLocation,
    zoom: 12,
    mapTypeControl: true,
    streetViewControl: true,
    fullscreenControl: true,
    styles: [{ featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }]
  });

  infoWindow = new google.maps.InfoWindow();
  loadIssuesOnMap();
}

async function loadIssuesOnMap() {
  try {
    const res = await adminFetch('/api/issues/public');
    const data = await res.json();
    const issues = data.issues || [];

    issueMarkers.forEach(m => m.setMap(null));
    issueMarkers = [];

    issues.forEach(issue => {
      if (issue.location && issue.location.coordinates) {
        const [lng, lat] = issue.location.coordinates;
        const color = getMarkerColor(issue.priority, issue.status);

        const marker = new google.maps.Marker({
          position: { lat, lng },
          map: adminMap,
          title: issue.title,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: color, fillOpacity: 0.85, strokeColor: '#fff', strokeWeight: 2 }
        });

        marker.addListener('click', () => {
          infoWindow.setContent(`
            <div style="max-width:280px;font-family:Inter,sans-serif;padding:4px;">
              <h3 style="font-weight:700;margin-bottom:8px;font-size:15px;">${issue.title}</h3>
              <p style="margin-bottom:4px;font-size:13px;"><strong>Category:</strong> ${issue.category}</p>
              <p style="margin-bottom:4px;font-size:13px;"><strong>Priority:</strong> <span style="color:${color};">${issue.priority}</span></p>
              <p style="margin-bottom:4px;font-size:13px;"><strong>Status:</strong> ${issue.status}</p>
              <p style="font-size:12px;color:#888;margin-top:8px;">${issue.location.address || ''}</p>
            </div>`);
          infoWindow.open(adminMap, marker);
        });

        issueMarkers.push(marker);
      }
    });

    if (issueMarkers.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      issueMarkers.forEach(m => bounds.extend(m.getPosition()));
      adminMap.fitBounds(bounds);
    }
  } catch (e) { console.error('Map error:', e); }
}

function getMarkerColor(priority, status) {
  if (['resolved', 'closed', 'approved'].includes(status)) return '#10B981';
  if (status === 'rejected') return '#EF4444';
  return { critical: '#DC2626', high: '#F59E0B', medium: '#3B82F6', low: '#6B7280' }[priority] || '#3B82F6';
}

// ── Badge Helpers ──
function statusBadge(status) {
  const map = {
    new: ['badge-new', 'New'],
    hold: ['badge-hold', 'On Hold'],
    approved: ['badge-approved', 'Approved'],
    rejected: ['badge-rejected', 'Rejected'],
    in_progress: ['badge-progress', 'In Progress'],
    resolved: ['badge-approved', 'Resolved'],
    closed: ['badge-closed', 'Closed']
  };
  const [cls, label] = map[status] || ['badge-closed', status];
  return `<span class="badge ${cls}"><span class="badge-dot"></span>${label}</span>`;
}

function priorityBadge(priority) {
  const p = (priority || 'medium').toLowerCase();
  return `<span class="priority-badge priority-${p}">
    <span class="priority-bars"><span></span><span></span><span></span></span>
    ${p.charAt(0).toUpperCase() + p.slice(1)}
  </span>`;
}

function categoryBadge(category) {
  const icons = { pothole: '🛣️', streetlight: '💡', garbage: '🗑️', water: '💧', sewage: '🚿', traffic: '🚦', road: '🛣️', other: '📌' };
  const cat = (category || 'other').toLowerCase();
  return `<span class="cat-badge ${cat}">${icons[cat] || '📌'} ${category || 'Other'}</span>`;
}

// Department options for assignment dropdown (matches departments page)
const ASSIGNMENT_OPTIONS = [
  { id: null, name: 'Unassigned' },
  { id: 'public-works', name: 'Public Works' },
  { id: 'parks-recreation', name: 'Parks & Recreation' },
  { id: 'environmental', name: 'Environmental' },
  { id: 'transportation', name: 'Transportation' },
  { id: 'health-sanitation', name: 'Health & Sanitation' }
];

function assignedBadge(assignedTo, issueId) {
  const displayName = assignedTo?.name || (assignedTo?.department ? 'Department' : null) || null;
  const isUnassigned = !displayName;
  const initials = displayName ? displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '—';
  const label = displayName || 'Unassigned';

  return `<div class="assigned-dropdown-wrap" onclick="event.stopPropagation();">
    <button type="button" class="assigned-dropdown-trigger assigned-badge" aria-haspopup="true" aria-expanded="false" aria-label="Assign issue" data-issue-id="${issueId || ''}" onclick="event.stopPropagation(); toggleAssignDropdown(this)">
      <span class="assigned-avatar ${isUnassigned ? 'unassigned' : ''}">${initials}</span>
      <span class="assigned-label">${label}</span>
      <svg class="assigned-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
    </button>
    <div class="assigned-dropdown-panel" id="assign-dropdown-${issueId || ''}" role="menu">
      ${ASSIGNMENT_OPTIONS.map(opt => `
        <button type="button" role="menuitem" class="assigned-dropdown-item" data-issue-id="${issueId || ''}" data-assign-id="${opt.id || ''}" data-assign-name="${(opt.name || '').replace(/"/g, '&quot;')}" onclick="event.stopPropagation(); selectAssignment(this)">
          ${opt.id ? opt.name : '— Unassigned'}
        </button>
      `).join('')}
    </div>
  </div>`;
}

window.toggleAssignDropdown = function (triggerBtn) {
  const wrap = triggerBtn.closest('.assigned-dropdown-wrap');
  if (!wrap) return;
  const panel = wrap.querySelector('.assigned-dropdown-panel');
  const isOpen = panel.classList.contains('open');

  // Close any other open assignment dropdowns
  document.querySelectorAll('.assigned-dropdown-panel.open').forEach(p => {
    if (p !== panel) {
      p.classList.remove('open');
      if (p._assignPortal && p._assignPortal.parentNode) p._assignPortal.parentNode.removeChild(p._assignPortal);
    }
  });
  document.querySelectorAll('.assigned-dropdown-trigger[aria-expanded="true"]').forEach(b => {
    if (b !== triggerBtn) b.setAttribute('aria-expanded', 'false');
  });

  if (isOpen) {
    panel.classList.remove('open');
    triggerBtn.setAttribute('aria-expanded', 'false');
    if (panel._assignPortal && panel._assignPortal.parentNode) {
      panel._assignPortal.parentNode.removeChild(panel._assignPortal);
    }
  } else {
    panel.classList.add('open');
    triggerBtn.setAttribute('aria-expanded', 'true');

    // Move dropdown to body and position below trigger (avoids overflow clipping)
    const rect = triggerBtn.getBoundingClientRect();
    let portal = panel._assignPortal;
    if (!portal) {
      portal = document.createElement('div');
      portal.className = 'assigned-dropdown-portal';
      portal.innerHTML = panel.innerHTML;
      portal.style.cssText = 'position:fixed;z-index:9999;min-width:180px;background:#fff;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.15);border:1px solid rgba(0,0,0,0.08);padding:6px;';
      portal.style.left = rect.left + 'px';
      portal.style.top = (rect.bottom + 4) + 'px';
      document.body.appendChild(portal);
      panel._assignPortal = portal;
      portal._originTrigger = triggerBtn;
      portal._originPanel = panel;
    } else {
      portal.style.left = rect.left + 'px';
      portal.style.top = (rect.bottom + 4) + 'px';
      document.body.appendChild(portal);
    }

    // Close on next click (defer so this click doesn't close immediately)
    setTimeout(function () {
      function closeHandler(e) {
        if (!wrap.contains(e.target) && !portal.contains(e.target)) {
          panel.classList.remove('open');
          triggerBtn.setAttribute('aria-expanded', 'false');
          if (portal.parentNode) portal.remove();
          document.removeEventListener('click', closeHandler);
          window.removeEventListener('scroll', scrollCloseHandler, true);
        }
      }
      document.addEventListener('click', closeHandler);
    }, 0);

    // Close on scroll of any container (capture phase catches inner div scroll too)
    function scrollCloseHandler() {
      panel.classList.remove('open');
      triggerBtn.setAttribute('aria-expanded', 'false');
      if (portal.parentNode) portal.remove();
      window.removeEventListener('scroll', scrollCloseHandler, true);
    }
    window.addEventListener('scroll', scrollCloseHandler, true);
  }
};

// Clean up any orphaned assignment dropdown portals (called before table re-renders)
function cleanupAssignPortals() {
  document.querySelectorAll('.assigned-dropdown-portal').forEach(p => p.remove());
  document.querySelectorAll('.assigned-dropdown-panel.open').forEach(p => p.classList.remove('open'));
  document.querySelectorAll('.assigned-dropdown-trigger[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

window.selectAssignment = async function (itemBtn) {
  const issueId = itemBtn.getAttribute('data-issue-id');
  const assignId = itemBtn.getAttribute('data-assign-id');
  const assignName = itemBtn.getAttribute('data-assign-name');

  // Use portal reference to find the correct trigger
  // (avoids querySelector matching wrong trigger when issue appears in both tables)
  const portalEl = itemBtn.closest('.assigned-dropdown-portal');
  let trigger;
  if (portalEl && portalEl._originTrigger) {
    trigger = portalEl._originTrigger;
  } else {
    trigger = document.querySelector(`.assigned-dropdown-trigger[data-issue-id="${issueId}"]`);
  }

  const wrap = trigger ? trigger.closest('.assigned-dropdown-wrap') : null;
  const panel = wrap ? wrap.querySelector('.assigned-dropdown-panel') : null;
  const labelEl = wrap ? wrap.querySelector('.assigned-label') : null;
  const avatarEl = wrap ? wrap.querySelector('.assigned-avatar') : null;
  const previousLabel = labelEl ? labelEl.textContent : 'Unassigned';
  const previousAvatar = avatarEl ? avatarEl.textContent : '—';
  const previousUnassigned = avatarEl ? avatarEl.classList.contains('unassigned') : true;

  if (panel) panel.classList.remove('open');
  if (trigger) trigger.setAttribute('aria-expanded', 'false');

  // Remove all portals (clean up any orphans)
  cleanupAssignPortals();

  if (labelEl) {
    labelEl.textContent = assignName || 'Unassigned';
  }
  if (avatarEl) {
    avatarEl.classList.toggle('unassigned', !assignId);
    avatarEl.textContent = assignId ? (assignName || ' ').charAt(0) : '—';
  }

  try {
    const response = await fetch(`/api/issues/${issueId}/assign`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...adminAuthHeader() },
      body: JSON.stringify({ assignee: assignId ? { department: assignId, name: assignName } : null })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || 'Failed to assign issue');
    }
    if (typeof loadAll === 'function') loadAll();
  } catch (e) {
    console.error('Assign failed', e);
    if (labelEl) labelEl.textContent = previousLabel;
    if (avatarEl) {
      avatarEl.textContent = previousAvatar;
      avatarEl.classList.toggle('unassigned', previousUnassigned);
    }
    showAdminToast(e.message || 'Failed to assign issue', 'error');
  }
};

function locationCell(issue) {
  const coords = issue.location?.coordinates;
  if (!coords) return issue.location?.address || '—';
  return `<div style="display:flex;align-items:center;gap:6px;">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
    <div>
      <div style="font-size:12px;color:var(--text-secondary);">Lat: ${coords[1]?.toFixed(5)}</div>
      <div style="font-size:12px;color:var(--text-muted);">Lng: ${coords[0]?.toFixed(5)}</div>
    </div>
  </div>`;
}

// ── Pagination ──
function renderPagination(containerId, totalItems, currentPg, fnName) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const start = totalItems > 0 ? (currentPg - 1) * pageSize + 1 : 0;
  const end = Math.min(currentPg * pageSize, totalItems);

  let html = `<div class="pagination-info">Showing <strong>${start}–${end}</strong> of <strong>${totalItems}</strong> issues</div>`;
  html += `<div class="pagination-controls">`;
  html += `<button class="page-btn" ${currentPg <= 1 ? 'disabled' : ''} onclick="${fnName}(${currentPg - 1})">‹</button>`;

  const maxBtns = 5;
  let sp = Math.max(1, currentPg - Math.floor(maxBtns / 2));
  let ep = Math.min(totalPages, sp + maxBtns - 1);
  if (ep - sp < maxBtns - 1) sp = Math.max(1, ep - maxBtns + 1);

  for (let i = sp; i <= ep; i++) {
    html += `<button class="page-btn ${i === currentPg ? 'active' : ''}" onclick="${fnName}(${i})">${i}</button>`;
  }
  if (ep < totalPages) {
    html += `<button class="page-btn" disabled>…</button>`;
    html += `<button class="page-btn" onclick="${fnName}(${totalPages})">${totalPages}</button>`;
  }
  html += `<button class="page-btn" ${currentPg >= totalPages ? 'disabled' : ''} onclick="${fnName}(${currentPg + 1})">›</button>`;
  html += `<select class="page-size-select" onchange="changePageSize(this.value,'${fnName}')">`;
  [10, 25, 50].forEach(s => { html += `<option value="${s}" ${s === pageSize ? 'selected' : ''}>${s} / page</option>`; });
  html += `</select></div>`;
  container.innerHTML = html;
}

function changePageSize(newSize, fnName) {
  pageSize = parseInt(newSize);
  currentPage = 1;
  issuesCurrentPage = 1;
  window[fnName] && window[fnName](1);
}

window.goToDashPage = function (page) { currentPage = page; renderPending(); };
window.goToIssuesPage = function (page) { issuesCurrentPage = page; renderIssuesPage(); };

// ── Row Builders ──
function buildPendingRow(issue) {
  const contractorStatus = issue.contractorAssignment?.status || 'none';
  const showAssignBtn = issue.status === 'approved' && contractorStatus === 'none';
  const showBidsBtn = ['sent_to_contractors', 'bidding_open', 'bid_accepted'].includes(contractorStatus);

  return `<tr class="issue-row-clickable" onclick="handleRowClick(event, '${issue._id}')" tabindex="0" role="button" aria-label="View issue details">
    <td class="cell-id" style="padding:14px 16px;">${issue._id.slice(-8)}</td>
    <td style="padding:14px 16px;">${categoryBadge(issue.category)}</td>
    <td style="padding:14px 16px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${issue.title || issue.description || '—'}</td>
    <td style="padding:14px 12px;">${locationCell(issue)}</td>
    <td style="padding:14px 12px;">${priorityBadge(issue.priority)}</td>
    <td style="padding:14px 12px;">${statusBadge(issue.status)}${contractorStatus !== 'none' ? `<br><span style="font-size:10px;color:#8b5cf6;">🏗️ ${contractorStatus.replace(/_/g, ' ')}</span>` : ''}</td>
    <td style="padding:14px 12px;">${assignedBadge(issue.assignedTo, issue._id)}</td>
    <td style="padding:14px 12px;">
      <div style="display:flex;gap:5px;flex-wrap:wrap;">
        <button data-id="${issue._id}" data-status="approved" class="btn btn-success btn-sm" style="padding:4px 10px;font-size:11px;">Approve</button>
        <button data-id="${issue._id}" data-status="rejected" class="btn btn-danger btn-sm" style="padding:4px 10px;font-size:11px;">Reject</button>
        <button data-id="${issue._id}" data-status="hold" class="btn btn-warning btn-sm" style="padding:4px 10px;font-size:11px;">Hold</button>
        ${showAssignBtn ? `<button onclick="triggerAiRecommend('${issue._id}')" class="btn btn-sm" style="padding:4px 10px;font-size:11px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;border:none;">🤖 Assign</button>` : ''}
        ${showBidsBtn ? `<button onclick="openBidsModal('${issue._id}')" class="btn btn-sm" style="padding:4px 10px;font-size:11px;background:#6366f1;color:white;border:none;">📋 Bids</button>` : ''}
      </div>
    </td>
  </tr>`;
}

function buildIssueRowFull(issue) {
  const contractorStatus = issue.contractorAssignment?.status || 'none';
  const showAssignBtn = issue.status === 'approved' && contractorStatus === 'none';
  const showBidsBtn = ['sent_to_contractors', 'bidding_open', 'bid_accepted'].includes(contractorStatus);
  const showCompletionBtn = ['completed', 'payment_pending', 'paid'].includes(contractorStatus);

  return `<tr class="issue-row-clickable" onclick="handleRowClick(event, '${issue._id}')" tabindex="0" role="button" aria-label="View issue details">
    <td style="padding:14px 10px 14px 16px;"><input type="checkbox" data-id="${issue._id}"></td>
    <td class="cell-id" style="padding:14px 10px;">${issue._id.slice(-8)}</td>
    <td style="padding:14px 10px;">${categoryBadge(issue.category)}</td>
    <td style="padding:14px 10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${issue.title || issue.description || '—'}</td>
    <td style="padding:14px 10px;">${locationCell(issue)}</td>
    <td style="padding:14px 10px;">${priorityBadge(issue.priority)}</td>
    <td style="padding:14px 10px;">${statusBadge(issue.status)}${contractorStatus !== 'none' ? `<br><span style="font-size:10px;color:#8b5cf6;">🏗️ ${contractorStatus.replace(/_/g, ' ')}</span>` : ''}</td>
    <td style="padding:14px 10px;">${assignedBadge(issue.assignedTo, issue._id)}</td>
    <td style="padding:14px 10px;">
      <div style="display:flex;gap:5px;flex-wrap:wrap;">
        <button onclick="openReportDetail('${issue._id}')" class="btn btn-success btn-sm" style="padding:4px 10px;font-size:11px;">🔍 View</button>
        ${showAssignBtn ? `<button onclick="triggerAiRecommend('${issue._id}')" class="btn btn-sm" style="padding:4px 10px;font-size:11px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;border:none;">🤖 Assign Contractor</button>` : ''}
        ${showBidsBtn ? `<button onclick="openBidsModal('${issue._id}')" class="btn btn-sm" style="padding:4px 10px;font-size:11px;background:#6366f1;color:white;border:none;">📋 Bids</button>` : ''}
        ${showCompletionBtn ? `<button onclick="openCompletionView('${issue._id}')" class="btn btn-sm" style="padding:4px 10px;font-size:11px;background:#10b981;color:white;border:none;">✅ Completion</button>` : ''}
        <button data-id="${issue._id}" data-status="rejected" class="btn btn-danger btn-sm" style="padding:4px 10px;font-size:11px;">Reject</button>
        <button data-id="${issue._id}" data-status="hold" class="btn btn-warning btn-sm" style="padding:4px 10px;font-size:11px;">Hold</button>
      </div>
    </td>
  </tr>`;
}

// ── Charts ──
let trendChartInst = null;
let catChartInst = null;

window.openIssueResolver = async function (issueId) {
  const existing = document.getElementById('aiResolverModal');
  if (existing) existing.remove();

  // Try to find in cache, otherwise fetch
  let issue = allIssues.find(i => i._id === issueId);
  if (!issue) {
    try {
      const resp = await fetch('/api/issues/' + issueId, { headers: adminAuthHeader() });
      issue = await resp.json();
    } catch (e) {
      alert("Error fetching issue details");
      return;
    }
  }

  const aiReasonStr = issue.aiClassification?.reason || 'No AI reason provided';
  const imgHtml = (issue.images && issue.images.length > 0)
    ? `<img src="${issue.images[0].url}" style="width:100%; max-height:200px; object-fit:cover; border-radius:8px; margin-bottom:16px;">`
    : `<div style="padding:20px; text-align:center; background:#F8FAFC; border-radius:8px; margin-bottom:16px; color:#94A3B8;">No Image Provided</div>`;

  const modalHtml = `
    <div id="aiResolverModal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9999; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(2px);">
      <div style="background:white; width:90%; max-width:600px; max-height:90vh; overflow-y:auto; border-radius:12px; padding:24px; box-shadow:0 10px 25px rgba(0,0,0,0.2);">
        <h3 style="margin-top:0; font-size:1.25rem;">Resolve Issue: ${issue.title || 'Untitled'}</h3>
        <p style="color:#64748B; font-size:0.9rem; margin-bottom:16px;">${issue.location?.address || 'No location'}</p>
        
        ${imgHtml}

        <div style="background:#F8FAFC; padding:12px; border:1px solid #E2E8F0; border-radius:8px; margin-bottom:20px;">
          <h4 style="margin:0 0 4px 0; font-size:0.9rem;">🤖 AI Classification Reason:</h4>
          <p style="margin:0; font-size:0.85rem; color:#475569;">${aiReasonStr}</p>
        </div>

        <h4 style="margin:0 0 12px 0;">Submit Resolution Proof</h4>
        <form id="resolveForm" onsubmit="event.preventDefault(); submitResolution('${issue._id}');">
          <label style="display:block; font-size:0.85rem; font-weight:600; margin-bottom:4px;">Upload 'After' Photo</label>
          <input type="file" id="resolvePhoto" accept="image/*" style="width:100%; padding:8px; border:1px solid #E2E8F0; border-radius:8px; margin-bottom:16px;" required>

          <label style="display:block; font-size:0.85rem; font-weight:600; margin-bottom:4px;">Resolution Notes / Action Taken</label>
          <textarea id="resolveNotes" rows="3" style="width:100%; padding:10px; border:1px solid #E2E8F0; border-radius:8px; margin-bottom:16px;" placeholder="Describe what was done to fix this..." required></textarea>

          <div style="display:flex; justify-content:flex-end; gap:12px;">
            <button type="button" onclick="document.getElementById('aiResolverModal').remove()" style="padding:10px 16px; border:none; background:none; cursor:pointer; color:#64748B; font-weight:600;">Cancel</button>
            <button type="submit" id="submitResolveBtn" style="padding:10px 16px; border:none; background:#10B981; color:white; border-radius:8px; cursor:pointer; font-weight:600;">✅ Upload & Resolve</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

window.submitResolution = async function (issueId) {
  const btn = document.getElementById('submitResolveBtn');
  const photoInput = document.getElementById('resolvePhoto');
  const notesInput = document.getElementById('resolveNotes');

  btn.disabled = true;
  btn.textContent = 'Uploading...';

  const formData = new FormData();
  if (photoInput.files[0]) {
    formData.append('resolutionImages', photoInput.files[0]);
  }
  formData.append('notes', notesInput.value || '');
  formData.append('status', 'resolved');

  try {
    const res = await fetch(`/api/issues/${issueId}/resolve`, {
      method: 'POST',
      headers: {
        'Authorization': adminAuthHeader().Authorization
      },
      body: formData
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || 'Failed to resolve');
    }

    alert("Issue successfully resolved with proof!");
    document.getElementById('aiResolverModal').remove();
    loadAll(); // refresh board
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
    btn.textContent = '✅ Upload & Resolve';
  }
}

function initCharts() {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const totals = new Array(12).fill(0);
  const approved = new Array(12).fill(0);
  const rejected = new Array(12).fill(0);

  allIssues.forEach(i => {
    const m = new Date(i.createdAt).getMonth();
    totals[m]++;
    if (i.status === 'approved') approved[m]++;
    if (i.status === 'rejected') rejected[m]++;
  });

  const trendCtx = document.getElementById('trendChart')?.getContext('2d');
  if (trendCtx) {
    if (trendChartInst) trendChartInst.destroy();
    trendChartInst = new Chart(trendCtx, {
      type: 'line',
      data: {
        labels: months,
        datasets: [
          { label: 'Total Issues', data: totals, borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.08)', fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#6366f1' },
          { label: 'Approved', data: approved, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.06)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 2, pointBackgroundColor: '#10b981' },
          { label: 'Rejected', data: rejected, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.04)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 2, pointBackgroundColor: '#ef4444' }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 18, font: { family: 'Inter', size: 12 } } } },
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { family: 'Inter', size: 11 } } },
          x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 11 } } }
        }
      }
    });
  }

  const catCounts = {};
  allIssues.forEach(i => { const c = i.category || 'other'; catCounts[c] = (catCounts[c] || 0) + 1; });
  const labels = Object.keys(catCounts);
  const values = Object.values(catCounts);
  const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#a855f7', '#6b7280'];

  const catCtx = document.getElementById('categoryChart')?.getContext('2d');
  if (catCtx) {
    if (catChartInst) catChartInst.destroy();
    catChartInst = new Chart(catCtx, {
      type: 'doughnut',
      data: {
        labels: labels.map(l => l.charAt(0).toUpperCase() + l.slice(1)),
        datasets: [{ data: values, backgroundColor: colors.slice(0, labels.length), borderWidth: 0, hoverOffset: 8 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: { legend: { position: 'right', labels: { usePointStyle: true, padding: 14, font: { family: 'Inter', size: 12 } } } }
      }
    });
  }
}

// ── Render Reports Table ──
function renderReports() {
  const tbody = document.getElementById('reportsTableBody');
  if (!tbody) return;

  const catSummary = {};
  allIssues.forEach(i => {
    const cat = i.category || 'other';
    if (!catSummary[cat]) catSummary[cat] = { count: 0, latest: i.createdAt };
    catSummary[cat].count++;
    if (new Date(i.createdAt) > new Date(catSummary[cat].latest)) catSummary[cat].latest = i.createdAt;
  });

  const depts = ['Public Works', 'Sanitation', 'Transportation', 'Environment', 'Electrical'];
  let html = '';
  let idx = 0;

  Object.entries(catSummary).forEach(([cat, info]) => {
    const dept = depts[idx % depts.length];
    const date = new Date(info.latest).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const fakeId = (Math.random().toString(36).substring(2, 10));
    html += `<tr>
      <td class="cell-id" style="padding:14px 20px;">${fakeId}</td>
      <td style="padding:14px 20px;font-weight:500;">📄 ${cat.charAt(0).toUpperCase() + cat.slice(1)} Reports</td>
      <td style="padding:14px 20px;">${dept}</td>
      <td style="padding:14px 20px;color:var(--text-muted);">${date}</td>
      <td style="padding:14px 20px;"><button class="report-download-btn" onclick="exportCSV()">Download</button></td>
    </tr>`;
    idx++;
  });

  tbody.innerHTML = html || '<tr><td colspan="5" class="empty-state" style="padding:32px;">No reports generated yet.</td></tr>';
}

// ── Notification Panel ──
function buildNotificationPanel() {
  // Remove existing panel if any
  const existing = document.getElementById('notifPanel');
  if (existing) { existing.remove(); return; }

  const panel = document.createElement('div');
  panel.id = 'notifPanel';
  panel.style.cssText = `
    position:fixed; top:72px; right:24px; z-index:999;
    background:#fff; border-radius:16px;
    box-shadow:0 8px 40px rgba(0,0,0,0.15);
    border:1px solid rgba(0,0,0,0.06);
    width:360px; max-height:440px;
    overflow:hidden; display:flex; flex-direction:column;
    animation:slideUp 0.2s ease;
  `;

  // Build notification items from recent issues
  const recent = allIssues
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 8);

  const statusColors = {
    new: '#3b82f6', hold: '#f59e0b', approved: '#10b981',
    rejected: '#ef4444', in_progress: '#7c3aed'
  };

  const statusLabels = {
    new: 'New issue reported',
    hold: 'Issue put on hold',
    approved: 'Issue approved',
    rejected: 'Issue rejected',
    in_progress: 'Issue in progress'
  };

  let itemsHtml = '';
  recent.forEach(issue => {
    const color = statusColors[issue.status] || '#6366f1';
    const label = statusLabels[issue.status] || issue.status;
    const time = timeAgo(issue.createdAt);
    itemsHtml += `
      <div style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(0,0,0,0.04);cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background='rgba(99,102,241,0.04)'" onmouseout="this.style.background='none'">
        <div style="width:9px;height:9px;border-radius:50%;background:${color};flex-shrink:0;margin-top:5px;"></div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:#1e1b4b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${issue.title || issue.description || 'Untitled Issue'}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">${label} · ${issue.category || 'General'}</div>
          <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${time}</div>
        </div>
      </div>`;
  });

  if (!itemsHtml) {
    itemsHtml = '<div style="padding:32px;text-align:center;color:#9ca3af;font-size:13px;">No notifications yet</div>';
  }

  panel.innerHTML = `
    <div style="padding:16px 20px;border-bottom:1px solid rgba(0,0,0,0.06);display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-size:15px;font-weight:700;color:#1e1b4b;">Notifications</div>
        <div style="font-size:12px;color:#9ca3af;margin-top:1px;">${recent.length} recent updates</div>
      </div>
      <button onclick="document.getElementById('notifPanel').remove()" style="background:none;border:none;cursor:pointer;padding:4px;color:#9ca3af;font-size:18px;line-height:1;">×</button>
    </div>
    <div style="overflow-y:auto;flex:1;">${itemsHtml}</div>
    <div style="padding:12px 16px;border-top:1px solid rgba(0,0,0,0.04);text-align:center;">
      <button onclick="showPage('issues', document.querySelector('[data-page=issues]'));document.getElementById('notifPanel').remove();" style="background:none;border:none;cursor:pointer;font-size:13px;font-weight:600;color:#6366f1;font-family:Inter,sans-serif;">View All Issues →</button>
    </div>
  `;

  document.body.appendChild(panel);

  // Close when clicking outside
  setTimeout(() => {
    document.addEventListener('click', function closeNotif(e) {
      if (!document.getElementById('notifPanel')?.contains(e.target) &&
        !e.target.closest('.notification-btn')) {
        document.getElementById('notifPanel')?.remove();
        document.removeEventListener('click', closeNotif);
      }
    });
  }, 100);
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ── Main DOMContentLoaded ──
document.addEventListener('DOMContentLoaded', () => {
  const tableBody = document.getElementById('issuesTableBody');
  const savedTableBody = document.getElementById('savedTableBody');
  const savedEmpty = document.getElementById('savedEmpty');
  const savedCount = document.getElementById('savedCount');
  let savedFilter = 'all';

  // ── Load all issues from API ──
  async function loadAll() {
    try {
      const res = await fetch('/api/issues/public', { headers: adminAuthHeader() });
      const data = await res.json();
      allIssues = data.issues || [];
    } catch (e) {
      console.error('Failed to load issues:', e);
      allIssues = [];
    }

    renderPending();
    renderSaved();
    renderIssuesPage();
    updateStats();
    renderReports();
    loadTrustData();

    // Update notification badge count
    const badge = document.querySelector('.notification-badge');
    if (badge) {
      const newCount = allIssues.filter(i => i.status === 'new').length;
      badge.textContent = newCount || '0';
    }

    if (typeof loadIssuesOnMap === 'function') loadIssuesOnMap();
  }

  // ── Feature 4: Load Sentiment Data ──
  async function loadSentimentData() {
    const scoreEl = document.getElementById('sentScore');
    const moodEl = document.getElementById('sentMood');
    const summaryEl = document.getElementById('sentSummary');
    const topicsEl = document.getElementById('sentTopicsList');
    const misinfoEl = document.getElementById('sentMisinfoList');
    const negativeEl = document.getElementById('sentNegativePct');
    const areaEl = document.getElementById('sentAreaList');

    if (!scoreEl) return;
    scoreEl.textContent = '...';

    try {
      const res = await adminFetch('/api/sentiment/dashboard');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();

      scoreEl.textContent = data.overallScore + '/100';
      moodEl.textContent = data.sentiment;
      if (negativeEl) negativeEl.textContent = (data.negativePercentage ?? 0) + '%';

      // Color code mood
      if (data.overallScore >= 70) moodEl.style.color = '#10B981';
      else if (data.overallScore >= 40) moodEl.style.color = '#F59E0B';
      else moodEl.style.color = '#EF4444';

      summaryEl.textContent = data.summary;

      // Topics
      topicsEl.innerHTML = '';
      if (data.trendingTopics && data.trendingTopics.length > 0) {
        data.trendingTopics.forEach(t => {
          const bg = t.volume > 75 ? '#EFF6FF' : (t.volume > 40 ? '#F8FAFC' : '#F8FAFC');
          topicsEl.innerHTML += `
          <div style="background:${bg}; padding:12px; border-radius:8px; display:flex; justify-content:space-between;">
            <span style="font-weight:500; color:#334155;">#${t.topic}</span>
            <span style="color:#64748B; font-size:0.9rem;">Vol: ${t.volume}%</span>
          </div>
        `;
        });
      } else {
        topicsEl.innerHTML = '<div style="color:#94A3B8;">No trending topics detected.</div>';
      }

      if (areaEl) {
        areaEl.innerHTML = '';
        if (data.areaWiseSentiment && data.areaWiseSentiment.length > 0) {
          data.areaWiseSentiment.forEach(item => {
            areaEl.innerHTML += `
              <div style="background:#F8FAFC; padding:12px; border-radius:10px;">
                <div style="display:flex; justify-content:space-between; gap:12px;">
                  <strong style="color:#1E293B;">${item.area}</strong>
                  <span style="color:#DC2626; font-weight:700;">${item.negativePercent}% negative</span>
                </div>
                <div style="margin-top:6px; font-size:.88rem; color:#64748B;">
                  Positive ${item.positivePercent}% • Neutral ${item.neutralPercent}% • Total ${item.total}
                </div>
              </div>
            `;
          });
        } else {
          areaEl.innerHTML = '<div style="color:#94A3B8;">No area-wise sentiment trends available.</div>';
        }
      }

      // Misinfo
      misinfoEl.innerHTML = '';
      if (data.misinformationFlags && data.misinformationFlags.length > 0) {
        data.misinformationFlags.forEach(m => {
          const color = m.risk.toLowerCase() === 'high' ? '#EF4444' : (m.risk.toLowerCase() === 'medium' ? '#F59E0B' : '#10B981');
          misinfoEl.innerHTML += `
          <div style="border-left: 3px solid ${color}; background:#FEF2F2; padding:12px; border-radius:4px;">
            <div style="font-weight:600; color:#1E293B; margin-bottom:4px;">Risk: ${m.risk}</div>
            <div style="color:#64748B; font-size:0.9rem;">"${m.claim}"</div>
          </div>
        `;
        });
      } else {
        misinfoEl.innerHTML = '<div style="color:#10B981;">No active misinformation detected. 🎉</div>';
      }

    } catch (err) {
      console.error('Sentiment load error', err);
      scoreEl.textContent = 'Error';
      if (negativeEl) negativeEl.textContent = '--';
      summaryEl.textContent = 'Failed to load AI sentiment data. Please check connection.';
    }
  }

  // ── Feature 6: Load Trust Dashboard Data ──
  async function loadTrustData() {
    try {
      const res = await adminFetch('/api/analytics/trust-dashboard');
      if (!res.ok) throw new Error('Failed to load trust data');
      const data = await res.json();

      const setEl = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };

      setEl('trustScoreVal', data.trustScore);
      setEl('trustSpeedVal', data.avgResolutionDays);
      setEl('trustRateVal', data.resolutionRate);

      const lbl = document.getElementById('trustStatusLabel');
      if (lbl) {
        lbl.textContent = `Execution: ${data.executionLabel}`;
        lbl.style.color = data.statusColor;
      }

    } catch (e) {
      console.error('Trust Load error:', e);
      const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      setEl('trustScoreVal', '--');
      setEl('trustSpeedVal', '--');
      setEl('trustRateVal', '--');
      const lbl = document.getElementById('trustStatusLabel');
      if (lbl) {
        lbl.textContent = 'Unable to load';
        lbl.style.color = '#ef4444';
      }
    }
  }

  window.loadAll = loadAll;
  window.loadSentimentData = loadSentimentData;
  window.loadTrustData = loadTrustData;

  // ── Render pending issues (Dashboard: new + hold) ──
  function renderPending() {
    const pending = allIssues.filter(i => i.status === 'new' || i.status === 'hold');
    const start = (currentPage - 1) * pageSize;
    const paginated = pending.slice(start, start + pageSize);

    cleanupAssignPortals();
    tableBody.innerHTML = '';
    if (pending.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="8" class="empty-state" style="padding:32px;">No pending issues</td></tr>';
    } else {
      paginated.forEach(issue => { tableBody.innerHTML += buildPendingRow(issue); });
    }
    renderPagination('dashPagination', pending.length, currentPage, 'goToDashPage');
  }

  // ── Render saved reports (approved + rejected) ──
  function renderSaved() {
    let saved = allIssues.filter(i => i.status === 'approved' || i.status === 'rejected');
    if (savedFilter === 'approved') saved = saved.filter(i => i.status === 'approved');
    if (savedFilter === 'rejected') saved = saved.filter(i => i.status === 'rejected');

    if (savedCount) savedCount.textContent = `(${saved.length})`;
    savedTableBody.innerHTML = '';

    if (saved.length === 0) {
      savedEmpty?.classList.remove('hidden');
      return;
    }
    savedEmpty?.classList.add('hidden');

    saved.forEach(issue => {
      savedTableBody.innerHTML += `<tr class="issue-row-clickable" onclick="handleRowClick(event, '${issue._id}')" tabindex="0" role="button" aria-label="View issue details">
        <td class="cell-id" style="padding:14px 20px;">${issue._id.slice(-8)}</td>
        <td style="padding:14px 20px;">${categoryBadge(issue.category)}</td>
        <td style="padding:14px 20px;">${issue.title || '—'}</td>
        <td style="padding:14px 20px;">${locationCell(issue)}</td>
        <td style="padding:14px 20px;">${priorityBadge(issue.priority)}</td>
        <td style="padding:14px 20px;">${statusBadge(issue.status)}</td>
      </tr>`;
    });
  }

  // ── Render Issues Page (full list with filters) ──
  function renderIssuesPage() {
    const tbody = document.getElementById('issuesPageTableBody');
    if (!tbody) return;

    let filtered = [...allIssues];

    const sq = document.getElementById('issueSearchInput')?.value?.toLowerCase() || '';
    const catV = document.getElementById('issueCategoryFilter')?.value || '';
    const statusV = document.getElementById('issueStatusFilter')?.value || '';
    const priorityV = document.getElementById('issuePriorityFilter')?.value || '';
    const sortV = document.getElementById('issueSortSelect')?.value || 'newest';

    if (sq) filtered = filtered.filter(i =>
      (i._id || '').toLowerCase().includes(sq) ||
      (i.title || '').toLowerCase().includes(sq) ||
      (i.description || '').toLowerCase().includes(sq) ||
      (i.location?.address || '').toLowerCase().includes(sq)
    );
    if (catV) filtered = filtered.filter(i => i.category === catV);
    if (statusV) filtered = filtered.filter(i => i.status === statusV);
    if (priorityV) filtered = filtered.filter(i => i.priority === priorityV);

    if (sortV === 'newest') filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    else if (sortV === 'oldest') filtered.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    else if (sortV === 'priority') {
      const ord = { critical: 0, high: 1, medium: 2, low: 3 };
      filtered.sort((a, b) => (ord[a.priority] ?? 4) - (ord[b.priority] ?? 4));
    }

    const start = (issuesCurrentPage - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);

    cleanupAssignPortals();
    tbody.innerHTML = '';
    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-state" style="padding:32px;">No issues found</td></tr>';
    } else {
      paginated.forEach(issue => { tbody.innerHTML += buildIssueRowFull(issue); });
    }

    renderPagination('issuesPagination', filtered.length, issuesCurrentPage, 'goToIssuesPage');
  }

  window.renderIssuesPage = renderIssuesPage;

  // ── Status change handler (shared by both tables) ──
  function handleStatusClick(e) {
    const btn = e.target.closest('[data-id][data-status]');
    if (!btn) return;
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '...';

    fetch(`/api/issues/${btn.dataset.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...adminAuthHeader() },
      body: JSON.stringify({ status: btn.dataset.status })
    })
      .then(() => loadAll())
      .catch(() => { btn.disabled = false; btn.textContent = origText; });
  }

  tableBody?.addEventListener('click', handleStatusClick);
  document.getElementById('issuesPageTableBody')?.addEventListener('click', handleStatusClick);

  // ── Saved filter buttons ──
  document.getElementById('filterAll')?.addEventListener('click', () => { savedFilter = 'all'; renderSaved(); });
  document.getElementById('filterApproved')?.addEventListener('click', () => { savedFilter = 'approved'; renderSaved(); });
  document.getElementById('filterRejected')?.addEventListener('click', () => { savedFilter = 'rejected'; renderSaved(); });

  // ── Export ──
  document.getElementById('exportBtn')?.addEventListener('click', exportCSV);
  document.getElementById('generateReportBtn')?.addEventListener('click', exportCSV);

  // ── Issues page filters ──
  document.getElementById('applyFiltersBtn')?.addEventListener('click', () => { issuesCurrentPage = 1; renderIssuesPage(); });
  document.getElementById('resetFiltersBtn')?.addEventListener('click', () => {
    ['issueSearchInput', 'issueCategoryFilter', 'issueStatusFilter', 'issuePriorityFilter'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    issuesCurrentPage = 1;
    renderIssuesPage();
  });
  document.getElementById('issueSortSelect')?.addEventListener('change', () => { issuesCurrentPage = 1; renderIssuesPage(); });

  // Filter on Enter key
  document.getElementById('issueSearchInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { issuesCurrentPage = 1; renderIssuesPage(); }
  });

  // Assuming showPage function exists elsewhere and handles page routing
  // This block is inserted based on the instruction's context for showPage calls
  function showPage(page) {
    if (page === 'dashboard') loadAll();
    if (page === 'reports') { issuesCurrentPage = 1; renderIssuesPage(); }
    if (page === 'sentiment') loadSentimentData();
    // Other page handling logic would go here
  }

  // ── Select all ──
  document.getElementById('selectAllIssues')?.addEventListener('change', function () {
    document.querySelectorAll('#issuesPageTableBody input[type="checkbox"]').forEach(cb => cb.checked = this.checked);
  });

  // ── Global search ──
  document.getElementById('globalSearch')?.addEventListener('input', function () {
    const q = this.value.toLowerCase();
    if (!q) { currentPage = 1; renderPending(); return; }
    const filtered = allIssues.filter(i =>
      (i.status === 'new' || i.status === 'hold') && (
        (i._id || '').toLowerCase().includes(q) ||
        (i.title || '').toLowerCase().includes(q) ||
        (i.category || '').toLowerCase().includes(q) ||
        (i.location?.address || '').toLowerCase().includes(q)
      )
    );
    tableBody.innerHTML = '';
    if (filtered.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="8" class="empty-state" style="padding:24px;">No matching issues</td></tr>';
    } else {
      filtered.slice(0, pageSize).forEach(issue => { tableBody.innerHTML += buildPendingRow(issue); });
    }
  });

  // ── Notification button ──
  document.querySelector('.notification-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    buildNotificationPanel();
  });

  // ── Dashboard filter dropdowns ──
  ['dashCategoryFilter', 'dashStatusFilter', 'dashPriorityFilter'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      const catF = document.getElementById('dashCategoryFilter')?.value || '';
      const statusF = document.getElementById('dashStatusFilter')?.value || '';
      const priorityF = document.getElementById('dashPriorityFilter')?.value || '';

      let filtered = allIssues.filter(i => i.status === 'new' || i.status === 'hold');
      if (catF && catF !== 'All Categories') filtered = filtered.filter(i => i.category === catF);
      if (statusF && statusF !== 'All Status') filtered = filtered.filter(i => i.status === statusF);
      if (priorityF && priorityF !== 'Priority') filtered = filtered.filter(i => i.priority === priorityF);

      tableBody.innerHTML = '';
      if (filtered.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="8" class="empty-state" style="padding:24px;">No issues match the filters</td></tr>';
      } else {
        filtered.slice(0, pageSize).forEach(issue => { tableBody.innerHTML += buildPendingRow(issue); });
      }
    });
  });

  // ── Initial load ──
  initAdminSocket();
  loadAll();
});

// ══════════════════════════════════════════════════════════════════
// CONTRACTOR MANAGEMENT FUNCTIONS
// ══════════════════════════════════════════════════════════════════

// Fix Modal Functions
window.openFixModal = function () {
  const modal = document.getElementById('fixIssueModal');
  const loading = document.getElementById('fixModalLoading');
  const success = document.getElementById('fixModalSuccess');
  const error = document.getElementById('fixModalError');

  // Reset to loading state
  loading.style.display = 'block';
  success.style.display = 'none';
  error.style.display = 'none';

  modal.classList.add('show');
};

window.closeFixModal = function () {
  document.getElementById('fixIssueModal').classList.remove('show');
};

window.updateFixModalSuccess = function () {
  document.getElementById('fixModalLoading').style.display = 'none';
  document.getElementById('fixModalSuccess').style.display = 'block';
  document.getElementById('fixModalError').style.display = 'none';
};

window.updateFixModalError = function (message) {
  document.getElementById('fixModalLoading').style.display = 'none';
  document.getElementById('fixModalSuccess').style.display = 'none';
  document.getElementById('fixModalError').style.display = 'block';
  document.getElementById('fixModalErrorMsg').textContent = message || 'An error occurred.';
};

// Send issue to contractors (Fix button)
window.sendToContractors = async function (issueId) {
  // Show loading modal
  openFixModal();

  try {
    const res = await fetch(`/api/admin/issue/${issueId}/send-to-contractors`, {
      method: 'POST',
      headers: adminAuthHeader()
    });

    const data = await res.json();

    if (res.ok && data.success) {
      updateFixModalSuccess();
      loadAll();
    } else {
      throw new Error(data.message || 'Failed to send to contractors');
    }
  } catch (e) {
    updateFixModalError(e.message);
  }
};

// Open bids modal for an issue
window.openBidsModal = async function (issueId) {
  const modal = document.getElementById('bidsModal');
  const issueInfo = document.getElementById('bidsModalIssueInfo');
  const content = document.getElementById('bidsModalContent');

  modal.classList.add('show');
  content.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;">Loading bids...</div>';

  try {
    // Get issue details
    const issue = allIssues.find(i => i._id === issueId);
    if (issue) {
      issueInfo.innerHTML = `
        <h4 style="margin:0 0 4px 0;">${issue.title || 'Untitled Issue'}</h4>
        <p style="margin:0;font-size:13px;color:#64748b;">📍 ${issue.location?.address || 'N/A'}</p>
        <div style="display:flex;gap:8px;margin-top:8px;">
          ${categoryBadge(issue.category)}
          ${priorityBadge(issue.priority)}
        </div>
      `;
    }

    // Fetch bids
    const res = await fetch(`/api/admin/issue/${issueId}/bids`, {
      headers: adminAuthHeader()
    });

    const data = await res.json();

    if (!res.ok) throw new Error(data.message);

    if (data.bids.length === 0) {
      content.innerHTML = `
        <div style="text-align:center;padding:40px;">
          <div style="font-size:48px;margin-bottom:12px;">📋</div>
          <p style="color:#64748b;">No bids received yet</p>
        </div>
      `;
      return;
    }

    // Render bids
    content.innerHTML = `
      ${data.recommendation ? `
        <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:16px;border-radius:12px;margin-bottom:16px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="font-size:20px;">🤖</span>
            <strong>AI Recommendation</strong>
          </div>
          <p style="margin:0;font-size:14px;opacity:0.95;">${data.recommendation.reason}</p>
        </div>
      ` : ''}
      <div style="display:flex;flex-direction:column;gap:12px;">
        ${data.bids.map(bid => `
          <div style="border:${bid.isAIRecommended ? '2px solid #6366f1' : '1px solid #e2e8f0'};border-radius:12px;padding:16px;${bid.isAIRecommended ? 'background:#f5f3ff;' : ''}">
            ${bid.isAIRecommended ? '<div style="display:inline-block;background:#6366f1;color:white;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;margin-bottom:12px;">🤖 RECOMMENDED</div>' : ''}
            <div style="display:flex;justify-content:space-between;align-items:start;">
              <div>
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                  <div style="width:40px;height:40px;border-radius:10px;background:#6366f1;color:white;display:flex;align-items:center;justify-content:center;font-weight:600;">
                    ${(bid.contractor.name || 'C').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h4 style="margin:0;font-size:15px;">${bid.contractor.name}</h4>
                    <p style="margin:0;font-size:12px;color:#64748b;">${bid.contractor.isVerified ? '✓ Verified' : ''} GST: ${bid.contractor.gstNumber}</p>
                  </div>
                </div>
                <div style="display:flex;gap:16px;font-size:13px;color:#64748b;margin-top:8px;">
                  <span>📍 ${bid.contractor.location?.address || 'N/A'}</span>
                  <span>⭐ ${bid.contractor.statistics?.averageRating?.toFixed(1) || '0.0'}/5</span>
                  <span>🏆 ${bid.contractor.statistics?.completedProjects || 0} projects</span>
                </div>
                <div style="margin-top:8px;font-size:12px;color:#94a3b8;">
                  Aadhaar: ${bid.contractor.aadhaarNumber}
                </div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:24px;font-weight:800;color:#1e293b;">₹${bid.bidAmount?.toLocaleString()}</div>
                <div style="font-size:13px;color:#64748b;">${bid.completionDays} days</div>
                <div style="font-size:12px;color:#94a3b8;">Deadline: ${new Date(bid.completionDeadline).toLocaleDateString()}</div>
              </div>
            </div>
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
              <span class="badge ${bid.status === 'pending' ? 'badge-hold' : bid.status === 'accepted' ? 'badge-approved' : 'badge-rejected'}">
                ${bid.status.toUpperCase()}
              </span>
              ${bid.status === 'pending' ? `
                <button onclick="acceptBid('${bid.id}')" class="btn btn-success btn-sm">✓ Accept Bid</button>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    content.innerHTML = `<div style="text-align:center;padding:40px;color:#ef4444;">Error: ${e.message}</div>`;
  }
};

// Close bids modal
window.closeBidsModal = function () {
  document.getElementById('bidsModal').classList.remove('show');
};

// Accept a bid
window.acceptBid = async function (bidId) {
  if (!confirm('Accept this bid? This will reject all other bids for this issue.')) return;

  try {
    const res = await fetch(`/api/admin/bid/${bidId}/accept`, {
      method: 'POST',
      headers: adminAuthHeader()
    });

    const data = await res.json();

    if (res.ok && data.success) {
      showAdminToast('Bid accepted successfully!', 'success');
      closeBidsModal();
      loadAll();
    } else {
      throw new Error(data.message || 'Failed to accept bid');
    }
  } catch (e) {
    showAdminToast(e.message, 'error');
  }
};

// Toast notification
function showAdminToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position:fixed; bottom:24px; right:24px; background:white; padding:16px 20px;
    border-radius:12px; box-shadow:0 10px 25px rgba(0,0,0,0.15);
    border-left:4px solid ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#6366f1'};
    z-index:99999; display:flex; align-items:center; gap:12px;
    animation: slideIn 0.3s ease-out; max-width:400px;
  `;
  toast.innerHTML = `
    <span style="font-size:20px;">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ️'}</span>
    <span style="color:#1e293b;font-weight:500;">${message}</span>
  `;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease-in forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ══════════════════════════════════════════════════════════════════
// REPORT DETAIL & AI CONTRACTOR ASSIGNMENT FLOW
// ══════════════════════════════════════════════════════════════════

window.handleRowClick = function (e, issueId) {
  // Ignore clicks on buttons, inputs, links, or custom assignment dropdowns
  const ignored = ['BUTTON', 'INPUT', 'A', 'SELECT'];
  if (ignored.includes(e.target.tagName)) return;
  if (e.target.closest('button') || e.target.closest('input') || e.target.closest('a') || e.target.closest('.assigned-dropdown-wrap')) return;
  openReportDetail(issueId);
};

// Open Report Detail Modal
window.openReportDetail = async function (issueId) {
  const modal = document.getElementById('reportDetailModal');
  const body = document.getElementById('rdBody');
  const title = document.getElementById('rdTitle');
  modal.style.display = 'flex';
  body.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;">Loading report...</div>';

  try {
    const res = await adminFetch(`/api/admin/issue/${issueId}/details`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);

    const issue = data.issue;
    const acceptedBid = data.acceptedBidDetails;
    title.textContent = `Report: ${issue.title || 'Untitled'}`;

    const coords = issue.location?.coordinates || [];
    const lat = coords[1] || 'N/A';
    const lng = coords[0] || 'N/A';
    const statusMap = {
      new: '🟡 New', approved: '🟢 Approved', rejected: '🔴 Rejected',
      hold: '🟠 On Hold', in_progress: '🔵 In Progress', resolved: '✅ Resolved'
    };

    // Build images HTML
    let imagesHTML = '<span style="color:#94a3b8;">No images</span>';
    if (issue.images && issue.images.length > 0) {
      imagesHTML = `<div class="rd-images">${issue.images.map(img =>
        `<img src="${img.url}" alt="Report image" onerror="this.style.display='none'">`
      ).join('')}</div>`;
    }

    let contractorHTML = '<div class="rd-value">No contractor assigned yet.</div>';
    if (acceptedBid?.contractor) {
      contractorHTML = `
        <div class="rd-value">
          <strong>${acceptedBid.contractor.name || 'Contractor'}</strong><br>
          ${acceptedBid.contractor.email || ''}<br>
          ${acceptedBid.contractor.phone || ''}<br>
          Avg Rating: ${(acceptedBid.contractor.statistics?.averageRating || 0).toFixed(1)}
        </div>
      `;
    }

    // Build action buttons based on contractor assignment status
    let actionHTML = '';
    const caStatus = issue.contractorAssignment?.status || 'none';

    if (issue.status === 'approved' && caStatus === 'none') {
      actionHTML = `<button onclick="triggerAiRecommend('${issue._id}')" class="btn btn-primary" style="width:100%;margin-top:20px;padding:14px;font-size:15px;font-weight:700;">
        🤖 Assign Contractor (AI Recommended)
      </button>`;
    } else if (['sent_to_contractors', 'bidding_open'].includes(caStatus)) {
      actionHTML = `<div style="display:flex;gap:12px;margin-top:20px;">
        <button onclick="closeReportDetail(); openBidsModal('${issue._id}')" class="btn btn-primary" style="flex:1;padding:14px;">📋 View Bids (${data.bidCount})</button>
        <span style="display:flex;align-items:center;color:#64748b;font-size:13px;">⏳ Awaiting bids...</span>
      </div>`;
    } else if (['bid_accepted', 'work_in_progress'].includes(caStatus)) {
      const cName = issue.contractorAssignment?.acceptedContractor?.name || 'Contractor';
      actionHTML = `<div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:16px;border-radius:12px;margin-top:20px;text-align:center;">
        <div style="font-size:13px;opacity:0.9;">🤖 BEST CONTRACTOR FOR THIS PROJECT</div>
        <div style="font-size:20px;font-weight:800;margin:4px 0;">${cName}</div>
        <div style="font-size:13px;opacity:0.8;">Status: ${caStatus.replace(/_/g, ' ').toUpperCase()}</div>
      </div>`;
    } else if (['completed', 'payment_pending', 'paid'].includes(caStatus)) {
      actionHTML = `<button onclick="closeReportDetail(); openCompletionView('${issue._id}')" class="btn btn-success" style="width:100%;margin-top:20px;padding:14px;">
        ✅ View Completion Report
      </button>`;
    }

    body.innerHTML = `
      <div class="rd-field"><div class="rd-label">Title</div><div class="rd-value" style="font-size:16px;font-weight:600;">${issue.title}</div></div>
      <div class="rd-field"><div class="rd-label">Description</div><div class="rd-value">${issue.description || '—'}</div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="rd-field"><div class="rd-label">Issue ID</div><div class="rd-value" style="font-family:monospace;">${issue._id}</div></div>
        <div class="rd-field"><div class="rd-label">Reported By</div><div class="rd-value">${issue.reportedBy?.name || 'Anonymous User'}</div></div>
        <div class="rd-field"><div class="rd-label">Category</div><div class="rd-value">${categoryBadge(issue.category)}</div></div>
        <div class="rd-field"><div class="rd-label">Priority</div><div class="rd-value">${priorityBadge(issue.priority)}</div></div>
        <div class="rd-field"><div class="rd-label">Status</div><div class="rd-value">${statusMap[issue.status] || issue.status}</div></div>
        <div class="rd-field"><div class="rd-label">Report Date</div><div class="rd-value">${new Date(issue.createdAt).toLocaleDateString()}</div></div>
      </div>
      <div class="rd-field"><div class="rd-label">Location</div><div class="rd-value">📍 ${issue.location?.address || `Lat: ${lat}, Lng: ${lng}`}</div></div>
      <div class="rd-field"><div class="rd-label">Images</div>${imagesHTML}</div>
      <div class="rd-field"><div class="rd-label">Assigned Contractor</div>${contractorHTML}</div>
      ${actionHTML}
    `;
  } catch (err) {
    body.innerHTML = `<div style="text-align:center;padding:40px;color:#ef4444;">Error: ${err.message}</div>`;
  }
};

window.closeReportDetail = function () {
  document.getElementById('reportDetailModal').style.display = 'none';
};

// ── AI Contractor Recommendation Flow ──
window.triggerAiRecommend = async function (issueId) {
  // Close report detail, open AI modal
  closeReportDetail();
  const modal = document.getElementById('aiRecommendModal');
  const loading = document.getElementById('aiLoadingState');
  const results = document.getElementById('aiResultsState');
  const error = document.getElementById('aiErrorState');

  modal.style.display = 'flex';
  loading.style.display = 'block';
  results.style.display = 'none';
  error.style.display = 'none';

  try {
    const res = await fetch(`/api/admin/issue/${issueId}/ai-recommend-contractors`, {
      method: 'POST',
      headers: adminAuthHeader()
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.message);

    loading.style.display = 'none';
    results.style.display = 'block';

    const rec = data.recommendation;
    const contractors = rec?.contractors || [];

    results.innerHTML = `
      <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:16px;border-radius:12px;margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:20px;">🤖</span>
          <strong>AI Analysis Complete</strong>
        </div>
        <p style="margin:0;font-size:14px;opacity:0.95;">${rec?.overallAnalysis || 'Analysis completed.'}</p>
        <p style="margin:4px 0 0;font-size:12px;opacity:0.7;">${rec?.totalAnalyzed || 0} contractors analyzed • Method: ${rec?.method || 'AI'}</p>
      </div>
      <h4 style="margin-bottom:12px;font-size:15px;">Top Recommended Contractors</h4>
      ${contractors.length === 0 ? '<p style="color:#94a3b8;">No contractors available.</p>' :
        contractors.map((c, i) => `
          <div class="ai-contractor-card ${i === 0 ? 'recommended' : ''}">
            ${i === 0 ? '<div style="display:inline-block;background:#6366f1;color:white;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;margin-bottom:10px;">🏆 TOP PICK</div>' : ''}
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div style="font-weight:700;font-size:15px;color:#1e293b;">${c.name}</div>
                <div style="font-size:13px;color:#64748b;margin-top:2px;">
                  ⭐ ${c.stats?.averageRating?.toFixed(1) || '0.0'} • 🏆 ${c.stats?.completedProjects || 0} projects
                  ${c.distanceKm !== null ? ` • 📍 ${c.distanceKm}km` : ''}
                  ${c.isVerified ? ' • ✓ Verified' : ''}
                </div>
              </div>
              <div style="background:#f0fdf4;color:#16a34a;padding:6px 12px;border-radius:8px;font-weight:700;font-size:14px;">
                ${c.score}/100
              </div>
            </div>
            <p style="margin:8px 0 0;font-size:13px;color:#64748b;">${c.reason}</p>
          </div>
        `).join('')
      }
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;padding:14px;border-radius:10px;margin-top:16px;">
        <p style="margin:0;color:#16a34a;font-weight:600;font-size:14px;">✅ Issue has been sent to all contractors for bidding!</p>
        <p style="margin:4px 0 0;color:#64748b;font-size:13px;">Contractors will receive a live notification. Bids will appear in real-time.</p>
      </div>
      <button onclick="closeAiRecommend(); if(typeof loadAll==='function') loadAll();" class="btn btn-primary" style="width:100%;margin-top:16px;padding:12px;">Done</button>
    `;
  } catch (err) {
    loading.style.display = 'none';
    error.style.display = 'block';
    document.getElementById('aiErrorMsg').textContent = err.message;
  }
};

window.closeAiRecommend = function () {
  document.getElementById('aiRecommendModal').style.display = 'none';
};

// ── Completion View ──
window.openCompletionView = async function (issueId) {
  const modal = document.getElementById('completionViewModal');
  const body = document.getElementById('completionViewBody');
  modal.style.display = 'flex';
  body.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;">Loading...</div>';

  try {
    const res = await adminFetch(`/api/admin/issue/${issueId}/details`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);

    const issue = data.issue;
    const bid = data.acceptedBidDetails;

    if (!bid || !bid.workProof) {
      body.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;">No completion data available yet.</div>';
      return;
    }

    const contractor = bid.contractor || {};
    const proof = bid.workProof;

    body.innerHTML = `
      <div style="background:#f8fafc;padding:16px;border-radius:12px;margin-bottom:20px;">
        <h4 style="margin:0 0 8px;font-size:15px;">${issue.title}</h4>
        <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:#64748b;">
          <span>${categoryBadge(issue.category)}</span>
          <span>${priorityBadge(issue.priority)}</span>
          <span>📍 ${issue.location?.address || 'N/A'}</span>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:12px;padding:14px;background:#f0f9ff;border-radius:10px;margin-bottom:20px;">
        <div style="width:44px;height:44px;border-radius:10px;background:#6366f1;color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;">
          ${(contractor.name || 'C').charAt(0).toUpperCase()}
        </div>
        <div>
          <div style="font-weight:700;color:#1e293b;">${contractor.name || 'Contractor'}</div>
          <div style="font-size:13px;color:#64748b;">⭐ ${contractor.statistics?.averageRating?.toFixed(1) || '0.0'} • 🏆 ${contractor.statistics?.completedProjects || 0} projects</div>
        </div>
      </div>

      <h4 style="margin-bottom:12px;">Before & After Comparison</h4>
      <div class="completion-compare">
        <div class="compare-col">
          <h4 style="color:#ef4444;">📷 Before</h4>
          ${proof.beforeImages && proof.beforeImages.length > 0
        ? proof.beforeImages.map(img => `<img src="${img.url}" alt="Before" style="margin-bottom:8px;" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22150%22><rect fill=%22%23f1f5f9%22 width=%22200%22 height=%22150%22/><text fill=%22%2394a3b8%22 x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22>No Image</text></svg>'">`).join('')
        : '<div style="padding:40px;background:#f8fafc;border-radius:10px;color:#94a3b8;">No before image</div>'
      }
        </div>
        <div class="compare-col">
          <h4 style="color:#10b981;">📷 After</h4>
          ${proof.afterImages && proof.afterImages.length > 0
        ? proof.afterImages.map(img => `<img src="${img.url}" alt="After" style="margin-bottom:8px;" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22150%22><rect fill=%22%23f0fdf4%22 width=%22200%22 height=%22150%22/><text fill=%22%2394a3b8%22 x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22>No Image</text></svg>'">`).join('')
        : '<div style="padding:40px;background:#f0fdf4;border-radius:10px;color:#94a3b8;">No after image</div>'
      }
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px;">
        <div style="background:#f8fafc;padding:12px;border-radius:8px;">
          <div style="font-size:12px;color:#64748b;font-weight:600;">COMPLETED AT</div>
          <div style="font-size:14px;color:#1e293b;margin-top:2px;">${proof.submittedAt ? new Date(proof.submittedAt).toLocaleString() : 'N/A'}</div>
        </div>
        <div style="background:#f8fafc;padding:12px;border-radius:8px;">
          <div style="font-size:12px;color:#64748b;font-weight:600;">BID AMOUNT</div>
          <div style="font-size:14px;color:#1e293b;margin-top:2px;">₹${bid.bidAmount?.toLocaleString() || 'N/A'}</div>
        </div>
      </div>

      ${proof.notes ? `<div style="margin-top:16px;padding:12px;background:#fffbeb;border-radius:8px;border:1px solid #fde68a;"><div style="font-size:12px;color:#92400e;font-weight:600;">CONTRACTOR NOTES</div><div style="font-size:14px;color:#78350f;margin-top:4px;">${proof.notes}</div></div>` : ''}

      ${bid.status === 'completed' || bid.workProof?.adminReview?.status !== 'verified' ? `
        <button onclick="verifyWorkFromView('${bid._id}')" class="btn btn-primary" style="width:100%;margin-top:20px;padding:14px;">Verify Work & Forward to Citizen</button>
      ` : ''}

      <div style="margin-top:18px; padding:16px; border:1px solid #E2E8F0; border-radius:12px;">
        <h4 style="margin:0 0 12px;">Contractor Rating</h4>
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px;">
          <label style="font-size:12px; color:#64748B;">Quality
            <input id="rateQuality" type="number" min="1" max="5" value="${bid.rating?.quality || ''}" style="width:100%; margin-top:6px; padding:10px; border:1px solid #CBD5E1; border-radius:8px;">
          </label>
          <label style="font-size:12px; color:#64748B;">Time
            <input id="rateTime" type="number" min="1" max="5" value="${bid.rating?.timeliness || ''}" style="width:100%; margin-top:6px; padding:10px; border:1px solid #CBD5E1; border-radius:8px;">
          </label>
          <label style="font-size:12px; color:#64748B;">Cost
            <input id="rateCost" type="number" min="1" max="5" value="${bid.rating?.cost || ''}" style="width:100%; margin-top:6px; padding:10px; border:1px solid #CBD5E1; border-radius:8px;">
          </label>
        </div>
        <textarea id="rateFeedback" placeholder="Optional rating notes" style="width:100%; margin-top:12px; min-height:90px; padding:12px; border:1px solid #CBD5E1; border-radius:10px;">${bid.rating?.feedback || ''}</textarea>
        <button onclick="submitContractorRating('${bid._id}')" class="btn btn-success" style="width:100%;margin-top:12px;padding:12px;">Save Rating</button>
      </div>

      ${bid.status === 'payment_requested' ? `<button onclick="approvePaymentFromView('${bid._id}')" class="btn btn-success" style="width:100%;margin-top:20px;padding:14px;">Approve Payment</button>` : ''}
    `;
  } catch (err) {
    body.innerHTML = `<div style="text-align:center;padding:40px;color:#ef4444;">Error: ${err.message}</div>`;
  }
};

window.closeCompletionView = function () {
  document.getElementById('completionViewModal').style.display = 'none';
};

window.approvePaymentFromView = async function (bidId) {
  if (!confirm('Approve payment for this completed work?')) return;
  try {
    const res = await adminFetch(`/api/admin/bid/${bidId}/approve-payment`, {
      method: 'POST',
      headers: adminAuthHeader()
    });
    const data = await res.json();
    if (res.ok) {
      showAdminToast('Payment approved!', 'success');
      closeCompletionView();
      if (typeof loadAll === 'function') loadAll();
    } else {
      showAdminToast(data.message || 'Error', 'error');
    }
  } catch (e) {
    showAdminToast(e.message, 'error');
  }
};

window.verifyWorkFromView = async function (bidId) {
  try {
    const res = await adminFetch(`/api/admin/bid/${bidId}/verify-work`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminAuthHeader() },
      body: JSON.stringify({ notes: 'Verified from admin completion view' })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to verify work');
    showAdminToast('Work verified and forwarded to citizen.', 'success');
    closeCompletionView();
    if (typeof loadAll === 'function') loadAll();
  } catch (e) {
    showAdminToast(e.message, 'error');
  }
};

window.submitContractorRating = async function (bidId) {
  const quality = Number(document.getElementById('rateQuality')?.value);
  const timeliness = Number(document.getElementById('rateTime')?.value);
  const cost = Number(document.getElementById('rateCost')?.value);
  const feedback = document.getElementById('rateFeedback')?.value || '';

  try {
    const res = await adminFetch(`/api/admin/bid/${bidId}/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminAuthHeader() },
      body: JSON.stringify({ quality, timeliness, cost, feedback })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to save rating');
    showAdminToast('Contractor rating saved.', 'success');
    if (typeof loadAll === 'function') loadAll();
  } catch (e) {
    showAdminToast(e.message, 'error');
  }
};

// ══════════════════════════════════════════════════════════════════
// SOCKET.IO REAL-TIME LISTENERS
// ══════════════════════════════════════════════════════════════════

(function initAdminSocketListeners() {
  if (typeof io === 'undefined') return;
  const socket = io();
  socket.emit('join-admin-room');

  socket.on('new_bid_submitted', (data) => {
    showAdminToast(`New bid from ${data.contractorName}: ₹${data.bidAmount?.toLocaleString()}`, 'info');
    if (typeof loadAll === 'function') loadAll();
  });

  socket.on('bid:accepted', (data) => {
    showAdminToast(`Bid accepted for ${data.contractorName}`, 'success');
    if (typeof loadAll === 'function') loadAll();
  });

  socket.on('work:completed', (data) => {
    showAdminToast(`Work completed by ${data.contractorName}! Location verified: ${data.distance}m`, 'success');
    if (typeof loadAll === 'function') loadAll();
  });
})();

