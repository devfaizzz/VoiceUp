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
  a.href = url;
  // Original filename format restored
  a.download = 'voiceup_report_' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
    const res = await fetch('/api/issues/public', { headers: adminAuthHeader() });
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

function assignedBadge(assignedTo) {
  if (!assignedTo?.name) return `<span class="assigned-badge"><span class="assigned-avatar unassigned">—</span>Unassigned</span>`;
  const initials = assignedTo.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  return `<span class="assigned-badge"><span class="assigned-avatar">${initials}</span>${assignedTo.name}</span>`;
}

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
  return `<tr>
    <td class="cell-id" style="padding:14px 16px;">${issue._id.slice(-8)}</td>
    <td style="padding:14px 16px;">${categoryBadge(issue.category)}</td>
    <td style="padding:14px 16px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${issue.title || issue.description || '—'}</td>
    <td style="padding:14px 12px;">${locationCell(issue)}</td>
    <td style="padding:14px 12px;">${priorityBadge(issue.priority)}</td>
    <td style="padding:14px 12px;">${statusBadge(issue.status)}</td>
    <td style="padding:14px 12px;">${assignedBadge(issue.assignedTo)}</td>
    <td style="padding:14px 12px;">
      <div style="display:flex;gap:5px;">
        <button data-id="${issue._id}" data-status="approved" class="btn btn-success btn-sm" style="padding:4px 10px;font-size:11px;">Approve</button>
        <button data-id="${issue._id}" data-status="rejected" class="btn btn-danger btn-sm" style="padding:4px 10px;font-size:11px;">Reject</button>
        <button data-id="${issue._id}" data-status="hold" class="btn btn-warning btn-sm" style="padding:4px 10px;font-size:11px;">Hold</button>
      </div>
    </td>
  </tr>`;
}

function buildIssueRowFull(issue) {
  return `<tr>
    <td style="padding:14px 10px 14px 16px;"><input type="checkbox" data-id="${issue._id}"></td>
    <td class="cell-id" style="padding:14px 10px;">${issue._id.slice(-8)}</td>
    <td style="padding:14px 10px;">${categoryBadge(issue.category)}</td>
    <td style="padding:14px 10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${issue.title || issue.description || '—'}</td>
    <td style="padding:14px 10px;">${locationCell(issue)}</td>
    <td style="padding:14px 10px;">${priorityBadge(issue.priority)}</td>
    <td style="padding:14px 10px;">${statusBadge(issue.status)}</td>
    <td style="padding:14px 10px;">${assignedBadge(issue.assignedTo)}</td>
    <td style="padding:14px 10px;">
      <div style="display:flex;gap:5px;">
        <button data-id="${issue._id}" data-status="approved" class="btn btn-success btn-sm" style="padding:4px 10px;font-size:11px;">Approve</button>
        <button data-id="${issue._id}" data-status="rejected" class="btn btn-danger btn-sm" style="padding:4px 10px;font-size:11px;">Reject</button>
        <button data-id="${issue._id}" data-status="hold" class="btn btn-warning btn-sm" style="padding:4px 10px;font-size:11px;">Hold</button>
      </div>
    </td>
  </tr>`;
}

// ── Charts ──
let trendChartInst = null;
let catChartInst = null;

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

    // Update notification badge count
    const badge = document.querySelector('.notification-badge');
    if (badge) {
      const newCount = allIssues.filter(i => i.status === 'new').length;
      badge.textContent = newCount || '0';
    }

    if (typeof loadIssuesOnMap === 'function') loadIssuesOnMap();
  }

  window.loadAll = loadAll;

  // ── Render pending issues (Dashboard: new + hold) ──
  function renderPending() {
    const pending = allIssues.filter(i => i.status === 'new' || i.status === 'hold');
    const start = (currentPage - 1) * pageSize;
    const paginated = pending.slice(start, start + pageSize);

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
      savedTableBody.innerHTML += `<tr>
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
