// ─── Google Maps ───────────────────────────────────────────────
let map, detailMap, marker, detailMarker, geocoder, mapLoaded = false;
let currentUserData = null; // cached from /api/users/me

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ─── Socket.io ──────────────────────────────────────────────────
let socket;
function initSocket() {
  socket = io();
  const u = getUser();
  if (u && u.id) {
    socket.emit('join', `user-${u.id}`);
  }

  socket.on('issue:status', data => {
    showToast(`🔔 Issue Status Updated: ${data.status.toUpperCase()}`, 'success');
    if (data.coinsAwarded > 0) {
      showToast(`🪙 +${data.coinsAwarded} Voice Coins awarded!`, 'success');
    }
    loadMyReports(); // Refresh list
    loadUserData();  // Refresh coins
  });
}

// ─── Maps ──────────────────────────────────────────────────────
function initMap() {
  const def = { lat: 28.6139, lng: 77.2090 };
  map = new google.maps.Map(document.getElementById('map'), {
    center: def, zoom: 13,
    mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
    styles: mapStyle()
  });
  geocoder = new google.maps.Geocoder();
  map.addListener('click', e => { placeMarker(e.latLng); reverseGeocode(e.latLng, true); });
  google.maps.event.addListenerOnce(map, 'idle', () => { mapLoaded = true; });
}

function mapStyle() {
  return [
    { featureType: 'all', elementType: 'geometry', stylers: [{ color: '#EDE9FE' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#C4B5FD' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#A5B4FC' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#5B21B6' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#EDE9FE' }] }
  ];
}

function placeMarker(location, onDetailMap) {
  if (onDetailMap) {
    if (detailMarker) detailMarker.setPosition(location);
    else detailMarker = new google.maps.Marker({ position: location, map: detailMap, animation: google.maps.Animation.DROP });
    return;
  }
  if (marker) marker.setPosition(location);
  else {
    marker = new google.maps.Marker({
      position: location, map, draggable: true,
      animation: google.maps.Animation.DROP,
      icon: {
        url: 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40"><ellipse cx="16" cy="38" rx="6" ry="2" fill="rgba(108,63,197,.25)"/><path d="M16 0C9 0 4 5 4 12c0 9 12 26 12 26S28 21 28 12C28 5 23 0 16 0z" fill="#8B5CF6"/><circle cx="16" cy="12" r="5" fill="#fff" opacity=".9"/></svg>`),
        scaledSize: new google.maps.Size(32, 40)
      }
    });
    marker.addListener('dragend', e => reverseGeocode(e.latLng, true));
  }
  document.getElementById('latitude').value = location.lat();
  document.getElementById('longitude').value = location.lng();
}

// Feature 4: Show location NAME (not raw lat/lng) in map coords bar
function reverseGeocode(latLng, updateMain) {
  if (!geocoder) return;
  geocoder.geocode({ location: latLng }, (results, status) => {
    const addr = (status === 'OK' && results[0]) ? results[0].formatted_address
      : `Lat: ${latLng.lat().toFixed(5)}, Lng: ${latLng.lng().toFixed(5)}`;
    if (updateMain) {
      document.getElementById('locationAddress').textContent = addr;
      const parts = addr.split(',');
      const areaName = parts.slice(0, 2).join(',').trim();
      document.getElementById('mapLocName').textContent = parts[0] || 'Custom Location';
      document.getElementById('mapLocAddr').textContent = parts.slice(1, 3).join(',').trim() || addr;
      // Show area name (instead of raw coords)
      document.getElementById('mapCoords').textContent =
        `📍 ${areaName} · ${latLng.lat().toFixed(4)}°N, ${latLng.lng().toFixed(4)}°E`;
    }
  });
}

// ─── Helpers ────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => { t.className = 'toast'; }, 3500);
}
function showLoader(v) { document.getElementById('loaderOverlay').classList.toggle('show', v); }
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function priorityInfo(p) {
  const m = { critical: { label: '🔴 Critical', cls: 'critical' }, high: { label: '🟠 High Priority', cls: 'high' }, medium: { label: '🟡 Medium', cls: 'medium' }, low: { label: '🟢 Low', cls: 'low' } };
  return m[p] || m.medium;
}
function catIcon(cat) {
  const i = { streetlight: '💡', water: '💧', road: '🛣️', garbage: '🗑️', pothole: '🕳️', sewage: '🚰', traffic: '🚦', other: '📌' };
  return i[cat] || '📌';
}
function catCls(cat) {
  const c = { streetlight: 'streetlight', water: 'water', road: 'road', garbage: 'garbage', pothole: 'road', sewage: 'water', traffic: 'road' };
  return c[cat] || 'road';
}
// Extract human-readable location from DB issue
function issueAddress(issue) {
  if (issue.address) return issue.address;
  if (issue.location && issue.location.address) return issue.location.address;
  if (issue.location && issue.location.city) return issue.location.city;
  if (issue.location && issue.location.coordinates)
    return `${issue.location.coordinates[1].toFixed(4)}°N, ${issue.location.coordinates[0].toFixed(4)}°E`;
  return '—';
}
function issueCoords(issue) {
  if (issue.latitude && issue.longitude) return { lat: parseFloat(issue.latitude), lng: parseFloat(issue.longitude) };
  if (issue.location && issue.location.coordinates && issue.location.coordinates.length >= 2)
    return { lat: issue.location.coordinates[1], lng: issue.location.coordinates[0] };
  return null;
}

function ensureCitizenVerificationProofContainer() {
  const card = document.getElementById('citizenVerificationCard');
  if (!card) return null;

  let proof = document.getElementById('citizenVerificationProof');
  if (proof) return proof;

  proof = document.createElement('div');
  proof.id = 'citizenVerificationProof';
  proof.className = 'verification-proof';
  proof.style.display = 'none';

  const actions = card.querySelector('.verification-actions');
  if (actions) card.insertBefore(proof, actions);
  else card.appendChild(proof);

  return proof;
}

function renderVerificationThumbs(images, emptyLabel, accentClass = '') {
  if (!images || images.length === 0) {
    return `<div class="verification-proof-empty ${accentClass}">${emptyLabel}</div>`;
  }

  return `
    <div class="verification-proof-strip">
      ${images.map(img => `<img src="${img.url}" alt="Verification image" class="verification-proof-thumb ${accentClass}" onerror="this.style.display='none'">`).join('')}
    </div>
  `;
}

function renderCitizenVerificationProof(issue) {
  const verification = issue.workVerification;
  if (!verification?.afterImages?.length) return '';

  const beforeImages = verification.beforeImages?.length
    ? verification.beforeImages
    : (issue.images || []).slice(0, 1);

  return `
    <div class="verification-proof-grid">
      <div class="verification-proof-group">
        <div class="verification-proof-label">Before</div>
        ${renderVerificationThumbs(beforeImages, 'No before image available')}
      </div>
      <div class="verification-proof-group after">
        <div class="verification-proof-label success">After</div>
        ${renderVerificationThumbs(verification.afterImages, 'No after image available', 'success')}
      </div>
    </div>
    ${verification.notes || verification.adminNotes ? `
      <div class="verification-proof-note">
        ${verification.notes ? `<div><strong>Contractor note:</strong> ${verification.notes}</div>` : ''}
        ${verification.adminNotes ? `<div><strong>Admin note:</strong> ${verification.adminNotes}</div>` : ''}
      </div>
    ` : ''}
    <div class="verification-proof-meta">
      ${verification.contractorName ? `<span>Contractor: ${verification.contractorName}</span>` : ''}
      ${verification.submittedAt ? `<span>Submitted: ${fmtDate(verification.submittedAt)}</span>` : ''}
      ${verification.verifiedAt ? `<span>Verified: ${fmtDate(verification.verifiedAt)}</span>` : ''}
    </div>
  `;
}

// ─── Badge ──────────────────────────────────────────────────────
function getBadge(n) {
  if (n >= 100) return { label: 'GOD', emoji: '⚡', color: '#F59E0B' };
  if (n >= 80) return { label: 'Knight', emoji: '🛡️', color: '#8B5CF6' };
  if (n >= 50) return { label: 'Superman', emoji: '🦸', color: '#3B82F6' };
  if (n >= 25) return { label: 'Warrior', emoji: '⚔️', color: '#EF4444' };
  if (n >= 10) return { label: 'Saviour', emoji: '🌟', color: '#10B981' };
  return { label: 'Newcomer', emoji: '👋', color: '#6B7280' };
}

// ─── Feature 1: Notification Dropdown ─────────────────────────
let notifOpen = false;
const NOTIFICATIONS = [
  { type: 'update', icon: '🔔', title: 'Your report is In Progress', msg: '"Streetlight not working" has been assigned to Public Works Dept.', time: '2h ago', unread: true },
  { type: 'reward', icon: '🎁', title: '+35 Voice Coins earned!', msg: 'Thank you for reporting a civic issue in your community.', time: '1d ago', unread: true },
  { type: 'update', icon: '✅', title: 'Status update on your report', msg: '"Large pothole" has been approved and is being tracked.', time: '3d ago', unread: false },
  { type: 'alert', icon: '⚠️', title: 'Reminder sent', msg: 'Officials have been reminded about your report.', time: '5d ago', unread: false }
];

function renderNotifDropdown() {
  const list = document.getElementById('notifDropdownList');
  if (!list) return;
  const unread = NOTIFICATIONS.filter(n => n.unread).length;
  const badge = document.getElementById('notifCount');
  if (badge) badge.textContent = unread;
  list.innerHTML = '';
  NOTIFICATIONS.forEach(n => {
    const div = document.createElement('div');
    div.className = `nd-item${n.unread ? ' unread' : ''}`;
    div.innerHTML = `
      <div class="nd-icon ${n.type}">${n.icon}</div>
      <div class="nd-text"><strong>${n.title}</strong><p>${n.msg}</p></div>
      <span class="nd-time">${n.time}</span>
    `;
    div.addEventListener('click', () => { n.unread = false; renderNotifDropdown(); });
    list.appendChild(div);
  });
}

function toggleNotifDropdown(e) {
  e.stopPropagation();
  const d = document.getElementById('notifDropdown');
  closeAllDropdowns();
  notifOpen = !notifOpen;
  d.classList.toggle('open', notifOpen);
}

// ─── Feature 3: Voice Coins + Wallet ──────────────────────────
let userCoins = 0;

function updateCoinsDisplay(coins) {
  userCoins = coins || 0;
  const el = document.getElementById('headerCoins');
  const wc = document.getElementById('walletCoins');
  if (el) el.textContent = userCoins;
  if (wc) wc.textContent = userCoins;
  // Disable redeem buttons if insufficient coins
  document.querySelectorAll('.redeem-btn').forEach(btn => {
    const cost = parseInt(btn.dataset.cost);
    btn.disabled = userCoins < cost;
    btn.textContent = userCoins < cost ? `Need ${cost} VC` : 'Redeem';
  });
}

function openWalletModal() {
  updateCoinsDisplay(userCoins);
  document.getElementById('walletModal').classList.add('open');
}
function closeWalletModal() { document.getElementById('walletModal').classList.remove('open'); }

// ─── Feature 5: Profile Dropdown + My Profile Modal ───────────
let profileDropOpen = false;

function toggleProfileDropdown(e) {
  e.stopPropagation();
  const d = document.getElementById('profileDropdown');
  closeAllDropdowns();
  profileDropOpen = !profileDropOpen;
  d.classList.toggle('open', profileDropOpen);
}

function closeAllDropdowns() {
  document.getElementById('notifDropdown')?.classList.remove('open');
  document.getElementById('profileDropdown')?.classList.remove('open');
  notifOpen = false;
  profileDropOpen = false;
}

function openProfileModal() {
  closeAllDropdowns();
  const overlay = document.getElementById('profileModal');
  overlay.classList.add('open');
  if (currentUserData) fillProfileModal(currentUserData);
}
function closeProfileModal() { document.getElementById('profileModal').classList.remove('open'); }

function fillProfileModal(userData) {
  const u = userData.user || userData;
  document.getElementById('pmName').textContent = u.name || 'User';
  document.getElementById('pmEmail').textContent = u.email || '—';
  const init = (u.name || 'U').charAt(0).toUpperCase();
  document.getElementById('pmAvatarInitial').textContent = init;

  // Stats
  const stats = u.statistics || {};
  document.getElementById('pmTotalReports').textContent = stats.totalReports || 0;
  document.getElementById('pmResolved').textContent = stats.resolvedReports || 0;
  document.getElementById('pmCoins').textContent = u.voiceCoins || 0;

  // Badge
  const badge = u.badge || getBadge(stats.totalReports || 0);
  const badgeEl = document.getElementById('pmBadge');
  badgeEl.textContent = `${badge.emoji} ${badge.label}`;
  badgeEl.style.background = badge.color + '22';
  badgeEl.style.color = badge.color;
  badgeEl.style.borderColor = badge.color + '55';

  // Form prefill
  document.getElementById('pmInputName').value = u.name || '';
  document.getElementById('pmInputPhone').value = u.phone || '';
  document.getElementById('pmInputBio').value = (u.profile && u.profile.bio) || '';
  document.getElementById('pmInputCity').value = (u.profile && u.profile.city) || '';
  document.getElementById('pmInputState').value = (u.profile && u.profile.state) || '';
}

// ─── Load User Data (coins + profile) ─────────────────────────
async function loadUserData() {
  try {
    const res = await fetch('/api/users/me', { headers: authHeader() });
    if (!res.ok) throw new Error('unauth');
    const data = await res.json();
    currentUserData = data;
    const u = data.user;

    // Update header
    if (u.name) {
      document.getElementById('userName').textContent = 'Hi, ' + u.name.split(' ')[0];
      document.getElementById('userInitial').textContent = u.name.charAt(0).toUpperCase();
      document.getElementById('pdName').textContent = u.name;
    }
    if (u.email) document.getElementById('pdEmail').textContent = u.email;

    updateCoinsDisplay(u.voiceCoins || 0);
  } catch (e) {
    // Fallback: use stored user
    const u = getUser();
    if (u) {
      document.getElementById('userName').textContent = 'Hi, ' + (u.name || 'User').split(' ')[0];
      document.getElementById('userInitial').textContent = ((u.name || 'U').charAt(0)).toUpperCase();
      document.getElementById('pdName').textContent = u.name || 'User';
      document.getElementById('pdEmail').textContent = u.email || '';
    }
  }
}

// ─── Category Buttons ──────────────────────────────────────────
function initCategoryButtons() {
  const btns = document.querySelectorAll('.cat-btn');
  const select = document.getElementById('category');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cat = btn.dataset.cat;
      for (const opt of select.options) {
        if (opt.value === cat) { select.value = cat; break; }
      }
    });
  });
}

function initCharCounter() {
  const ta = document.getElementById('description');
  const cc = document.getElementById('charCount');
  if (ta && cc) ta.addEventListener('input', () => { cc.textContent = ta.value.length; });
}

function initImagePreview() {
  const input = document.getElementById('photo');
  const img = document.getElementById('previewImg');
  const ph = document.getElementById('previewPlaceholder');
  if (!input) return;
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (file) {
      img.src = URL.createObjectURL(file);
      img.style.display = 'block';
      if (ph) ph.style.display = 'none';
    }
  });
}

// ─── Report Detail Modal ───────────────────────────────────────
let detailMapInitialized = false;
let currentReport = null;
let nearbyIssues = [];

async function refreshIssueDetails(issueId, { trackView = false } = {}) {
  const endpoint = trackView ? `/api/issues/${issueId}/view` : `/api/issues/${issueId}`;
  const method = trackView ? 'POST' : 'GET';
  const res = await fetch(endpoint, { method, headers: authHeader() });
  if (!res.ok) throw new Error('Failed to load issue');
  const data = await parseJsonSafe(res);
  return data.issue || data;
}

async function openDetailModal(issue) {
  try {
    currentReport = await refreshIssueDetails(issue._id, { trackView: true });
  } catch (e) {
    currentReport = issue;
  }
  issue = currentReport;
  const overlay = document.getElementById('detailModal');

  document.getElementById('bcTitle').textContent = issue.title || 'Report Detail';
  document.getElementById('mdIcon').textContent = catIcon(issue.category);
  document.getElementById('mdTitle').textContent = issue.title || '—';

  const pi = priorityInfo(issue.priority);
  const pBadge = document.getElementById('mdPriority');
  pBadge.textContent = pi.label; pBadge.className = `priority-badge ${pi.cls}`;

  const sp = document.getElementById('mdStatus');
  const rawStatus = (issue.status || 'submitted');
  const st = rawStatus.toLowerCase().replace(/_/g, '-').replace(' ', '-');
  const stLabels = { 'in-progress': 'In Progress', 'in_progress': 'In Progress', approved: 'Approved', submitted: 'Submitted', new: 'Submitted', resolved: 'Resolved', rejected: 'Rejected', acknowledged: 'Acknowledged' };
  sp.textContent = stLabels[st] || rawStatus;
  sp.className = `status-pill ${st === 'in_progress' ? 'in-progress' : st}`;

  // Feature 4: Show human-readable address
  const addr = issueAddress(issue);
  document.getElementById('mdAddr').textContent = addr;
  document.getElementById('mdDate').textContent = fmtDate(issue.createdAt);
  document.getElementById('mdViews').textContent = issue.viewCount || issue.views || '—';
  document.getElementById('mdLikes').textContent = (issue.upvotes && issue.upvotes.length) || issue.upvotesCount || '—';
  const upvoteBtn = document.getElementById('detailUpvoteBtn');
  const upvoteNote = document.getElementById('detailUpvoteNote');
  if (upvoteBtn) {
    const hasUpvoted = !!issue.hasUpvoted;
    upvoteBtn.disabled = hasUpvoted;
    upvoteBtn.textContent = hasUpvoted ? 'Already Upvoted' : 'Upvote This Issue';
  }
  if (upvoteNote) {
    upvoteNote.textContent = issue.hasUpvoted
      ? 'Your upvote is already counted.'
      : 'One upvote per citizen.';
  }

  const pts = issue.voiceCoins || issue.voicePoints || 35;
  document.getElementById('mdPoints').textContent = pts;

  // Timeline logic
  const timeline = issue.timeline || [];
  const getTlDate = (stArr) => {
    const entry = timeline.find(t => stArr.includes(t.status?.toLowerCase().replace(/_/g, '-')));
    return entry ? fmtDate(entry.timestamp) : '—';
  };

  const isResolved = ['resolved', 'closed'].includes(st);
  const isApproved = ['approved', 'resolved', 'closed'].includes(st);
  const isInProgress = ['in-progress', 'in_progress', 'acknowledged'].includes(st) || isApproved;
  const isRejected = st === 'rejected';

  document.getElementById('tl-submitted').textContent = fmtDate(issue.createdAt);
  document.getElementById('tl-inprogress').textContent = getTlDate(['in-progress', 'in_progress', 'acknowledged']);
  document.getElementById('tl-approved').textContent = getTlDate(['approved']);
  document.getElementById('tl-resolved').textContent = getTlDate(['resolved', 'closed', 'rejected']);

  const tlIP = document.getElementById('tlInProgress');
  const tlAP = document.getElementById('tlApproved');
  const tlRS = document.getElementById('tlResolved');
  if (tlIP) tlIP.className = 'tl-step' + (isApproved || isRejected ? ' done' : isInProgress ? ' active' : '');
  if (tlAP) tlAP.className = 'tl-step' + (isResolved || isRejected ? ' done' : isApproved ? ' active' : '');
  if (tlRS) {
    tlRS.className = 'tl-step' + (isResolved || isRejected ? ' active' : '');
    const titleEl = tlRS.querySelector('.tl-name');
    if (titleEl) titleEl.textContent = isRejected ? 'Rejected' : 'Resolved';
  }

  const an = document.getElementById('assignedNote');
  const dept = (issue.assignedTo && issue.assignedTo.department) ? 'Public Works Department' : null;
  if (dept) { document.getElementById('assignedDept').textContent = dept; an.style.display = 'flex'; }
  else an.style.display = 'none';

  const rc = document.getElementById('reminderCard');
  // Make reminder visible for pending/rejected issues (removed 24h limit)
  rc.style.display = (!isResolved) ? 'flex' : 'none';

  const citizenVerificationCard = document.getElementById('citizenVerificationCard');
  const citizenVerificationText = document.getElementById('citizenVerificationText');
  const citizenVerificationProof = ensureCitizenVerificationProofContainer();
  const currentUserId = currentUserData?.user?._id || getUser()?.id;
  const isReporter = issue.reportedBy && String(issue.reportedBy) === String(currentUserId);
  const canRespond = isReporter && issue.citizenFeedback && issue.citizenFeedback.status === 'pending';
  if (citizenVerificationCard) {
    citizenVerificationCard.style.display = canRespond ? 'flex' : 'none';
    citizenVerificationCard.classList.toggle('has-proof', canRespond && !!issue.workVerification?.afterImages?.length);
    if (citizenVerificationText && canRespond) {
      citizenVerificationText.textContent = issue.workVerification?.contractorName
        ? `Admin verified ${issue.workVerification.contractorName}'s submitted work. Please review the photos and confirm if you are satisfied.`
        : 'Admin verified the submitted work. Please review the photos and confirm if you are satisfied.';
    }
  }
  if (citizenVerificationProof) {
    if (canRespond && issue.workVerification?.afterImages?.length) {
      citizenVerificationProof.innerHTML = renderCitizenVerificationProof(issue);
      citizenVerificationProof.style.display = 'block';
    } else {
      citizenVerificationProof.innerHTML = '';
      citizenVerificationProof.style.display = 'none';
    }
  }

  // Mini map header — show location name
  document.getElementById('mdMapName').textContent = addr.split(',')[0] || 'Location';
  document.getElementById('mdMapAddr').textContent = addr;
  const coords = issueCoords(issue);
  document.getElementById('mdCoords').textContent = coords
    ? `📍 ${coords.lat.toFixed(4)}°N, ${coords.lng.toFixed(4)}°E`
    : '—';

  // Feature 3: Before / After Verification Proof
  const proofContainer = document.getElementById('verificationProofContainer');
  if (proofContainer) proofContainer.remove(); // Clean up previous

  if (isResolved && issue.resolution && issue.resolution.resolutionImages && issue.resolution.resolutionImages.length > 0) {
    const defaultPlaceholder = 'https://placehold.co/400x300/f8fafc/94a3b8?text=No+Image';
    const beforeImg = (issue.images && issue.images.length > 0) ? issue.images[0].url : defaultPlaceholder;
    const afterImg = issue.resolution.resolutionImages[0].url;

    // Create the Before/After card
    const proofDiv = document.createElement('div');
    proofDiv.id = 'verificationProofContainer';
    proofDiv.style.cssText = 'margin-top: 20px; background: white; border-radius: 12px; padding: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);';
    proofDiv.innerHTML = `
      <h3 style="font-size: 1rem; font-weight: 600; color: #1E293B; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
        ✅ Issue Resolved — Visual Proof
      </h3>
      <div style="display: flex; gap: 12px; margin-bottom: 12px;">
        <div style="flex: 1;">
          <div style="font-size: 0.75rem; font-weight: 600; color: #64748B; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Before</div>
          <div style="height: 140px; border-radius: 8px; overflow: hidden; background: #F1F5F9; border: 1px solid #E2E8F0;">
            <img src="${beforeImg}" style="width: 100%; height: 100%; object-fit: cover;" alt="Before">
          </div>
        </div>
        <div style="display: flex; align-items: center; color: #94A3B8;">→</div>
        <div style="flex: 1;">
          <div style="font-size: 0.75rem; font-weight: 600; color: #10B981; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">After (Verified)</div>
          <div style="height: 140px; border-radius: 8px; overflow: hidden; background: #ECFDF5; border: 2px solid #34D399;">
            <img src="${afterImg}" style="width: 100%; height: 100%; object-fit: cover;" alt="After">
          </div>
        </div>
      </div>
      <div style="font-size: 0.85rem; color: #64748B; background: #F8FAFC; padding: 8px 12px; border-radius: 6px; border-left: 3px solid #6366F1;">
        "${issue.resolution.resolutionNotes || 'Issue has been successfully resolved.'}"<br>
        <span style="font-size: 0.7rem; color: #94A3B8; margin-top: 4px; display: block;">Verified on ${fmtDate(issue.resolution.resolvedAt)}</span>
      </div>
    `;

    // Insert after the mini map container
    const mmContainer = document.querySelector('.mini-map-card');
    if (mmContainer) {
      mmContainer.insertAdjacentElement('afterend', proofDiv);
    }
  }

  buildFeed(issue);
  overlay.classList.add('open');

  // Init detail map
  setTimeout(() => {
    const center = coords || { lat: 28.6139, lng: 77.2090 };
    if (!detailMapInitialized) {
      detailMap = new google.maps.Map(document.getElementById('detailMap'), {
        center, zoom: 15,
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
        styles: mapStyle()
      });
      detailMapInitialized = true;
    } else {
      detailMap.setCenter(center);
    }
    if (coords) placeMarker(new google.maps.LatLng(coords.lat, coords.lng), true);
  }, 120);
}

function buildFeed(issue) {
  const list = document.getElementById('feedList');
  const timeline = issue.timeline || [];
  const tabU = document.getElementById('tabUpdates');
  const tabP = document.getElementById('tabPoints');
  const coins = issue.voiceCoins || issue.voicePoints || 0;
  if (tabU) tabU.textContent = `Updates (${timeline.length || 1})`;
  if (tabP) tabP.textContent = `Points (${coins})`;

  list.innerHTML = '';
  if (timeline.length === 0) {
    const synth = [];
    if (issue.createdAt) synth.push({ date: issue.createdAt, title: 'Issue reported by you', body: 'Your report has been received and is being reviewed.', dept: 'You', points: [coins > 0 ? coins : 10] });
    if (issue.status && !['new'].includes(issue.status)) synth.push({ date: issue.updatedAt || issue.createdAt, title: `Status updated to "${issue.status}"`, body: 'Officials have reviewed your report.', dept: 'System' });
    synth.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(u => renderFeedItem(list, u));
  } else {
    [...timeline].reverse().forEach(t => renderFeedItem(list, { date: t.timestamp, title: `Status: ${t.status}`, body: t.notes || 'Status was updated.', dept: 'System' }));
  }
}

function renderFeedItem(container, u) {
  const div = document.createElement('div');
  div.className = 'feed-item';
  const ago = u.date ? timeAgo(u.date) : '';
  const ptsHtml = (u.points || []).map(p => `<span class="feed-point-chip">🎁 ${p} Voice Points</span>`).join('');
  div.innerHTML = `
    <div class="feed-item-top">
      <div>
        <span class="feed-date">${fmtDate(u.date)}</span>
        ${u.dept ? `<span class="feed-dept" style="margin-left:10px;display:inline-flex;align-items:center;gap:4px;"><span class="feed-dept-icon">🏢</span><span class="feed-dept-name">${u.dept}</span></span>` : ''}
      </div>
      ${ago ? `<span class="feed-ago">${ago}</span>` : ''}
    </div>
    <div class="feed-item-title">${u.title || ''}</div>
    <div class="feed-item-body">${u.body || u.message || ''}</div>
    ${ptsHtml ? `<div class="feed-points-row">${ptsHtml}</div>` : ''}
  `;
  container.appendChild(div);
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr);
  const h = Math.floor(diff / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d > 1 ? 's' : ''} ago`;
}

function closeDetailModal() { document.getElementById('detailModal').classList.remove('open'); }

// ─── Feature 2: My Reports (real API, correct field mapping) ─
window.myIssues = [];

async function loadMyReports() {
  const list = document.getElementById('reportsList');
  if (!list) return;
  try {
    let q = '';
    try {
      const anonIds = JSON.parse(localStorage.getItem('voiceup_anon_issues') || '[]');
      if (anonIds && anonIds.length > 0) {
        q = '?ids=' + anonIds.join(',');
      }
    } catch (e) { }

    const res = await fetch('/api/issues/my-issues' + q, { headers: authHeader() });
    if (!res.ok) {
      if (res.status === 401) console.warn('Unauthorized: Please log in to see your user-associated reports');
      else throw new Error('Failed to fetch user issues');
    }

    const data = res.ok ? await parseJsonSafe(res) : [];
    window.myIssues = data.issues || data || [];
    renderReportsList(window.myIssues, list, 5);
  } catch (err) {
    console.error('Error loading my reports:', err);
    window.myIssues = [];
    renderReportsList(window.myIssues, list, 5);
  }
}

async function loadNearbyIssues() {
  const list = document.getElementById('nearbyIssuesList');
  if (!list) return;

  list.innerHTML = '<p style="text-align:center;color:#A78BFA;font-size:.85rem;padding:20px 0;">Fetching nearby issues...</p>';

  if (!navigator.geolocation) {
    list.innerHTML = '<p style="text-align:center;color:#A78BFA;font-size:.85rem;padding:20px 0;">Geolocation is not supported on this device.</p>';
    return;
  }

  navigator.geolocation.getCurrentPosition(async (position) => {
    try {
      const radius = 5000;
      const res = await fetch(`/api/issues/nearby?latitude=${position.coords.latitude}&longitude=${position.coords.longitude}&radius=${radius}`);

      if (!res.ok) throw new Error('Failed to fetch nearby issues');
      const data = await parseJsonSafe(res);
      nearbyIssues = data.issues || [];

      const radiusLabel = document.getElementById('nearbyRadiusLabel');
      if (radiusLabel) radiusLabel.textContent = `Radius: ${Math.round((data.radius || radius) / 1000)} km`;

      renderReportsList(nearbyIssues, list, 6, { includeDistance: true, emptyMessage: 'No nearby issues found yet.' });
    } catch (error) {
      console.error('Error loading nearby issues:', error);
      list.innerHTML = '<p style="text-align:center;color:#A78BFA;font-size:.85rem;padding:20px 0;">Unable to load nearby issues right now.</p>';
    }
  }, () => {
    list.innerHTML = '<p style="text-align:center;color:#A78BFA;font-size:.85rem;padding:20px 0;">Allow location access to see nearby issues.</p>';
  }, {
    enableHighAccuracy: true,
    timeout: 10000
  });
}

async function parseJsonSafe(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function renderReportsList(issues, containerStrOrEl = 'reportsList', limit = null, options = {}) {
  const container = typeof containerStrOrEl === 'string' ? document.getElementById(containerStrOrEl) : containerStrOrEl;
  if (!container) return;
  container.innerHTML = '';
  if (!issues || !issues.length) {
    container.innerHTML = `<p style="text-align:center;color:#A78BFA;font-size:.85rem;padding:20px 0;">${options.emptyMessage || 'No reports yet. Submit your first report!'}</p>`;
    return;
  }

  let issuesToRender = issues;
  if (limit) issuesToRender = issues.slice(0, limit);

  issuesToRender.forEach(issue => {
    const rawSt = (issue.status || 'new');
    const st = rawSt.toLowerCase().replace(/_/g, '-');
    const prog = { new: 10, submitted: 15, 'in-progress': 50, acknowledged: 45, approved: 75, resolved: 100, rejected: 100, closed: 100 }[st] || 15;
    const stLabel = { 'in-progress': 'In Progress', approved: 'Approved', submitted: 'Submitted', new: 'Submitted', resolved: 'Resolved', rejected: 'Rejected', acknowledged: 'In Review', closed: 'Closed' }[st] || rawSt;
    const addr = issueAddress(issue);
    const div = document.createElement('div');
    div.className = 'report-item';
    div.innerHTML = `
      <div class="report-icon ${catCls(issue.category)}">${catIcon(issue.category)}</div>
      <div class="report-info">
        <div class="report-title">${issue.title}</div>
        <div class="report-date">${fmtDate(issue.createdAt)} · ${addr.split(',')[0]}</div>
        <div class="report-meta">
          <span class="prio-dot ${issue.priority}"></span>
          <span class="prio-label">${issue.priority ? issue.priority.charAt(0).toUpperCase() + issue.priority.slice(1) : 'Medium'}</span>
        </div>
        <div class="report-stats">
          <span>↑ ${issue.upvoteCount || issue.upvotes?.length || 0}</span>
          <span>👁 ${issue.viewCount || 0}</span>
          ${options.includeDistance && issue.distance ? `<span>📍 ${issue.distance}m</span>` : ''}
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${prog}%"></div></div>
      </div>
      <span class="status-badge ${st === 'in_progress' ? 'in-progress' : st}">${stLabel}</span>
      <span class="report-more">⋯</span>
    `;
    div.addEventListener('click', () => openDetailModal(issue));
    container.appendChild(div);
  });
}

async function handleDetailUpvote() {
  if (!currentReport) return;
  const btn = document.getElementById('detailUpvoteBtn');
  const note = document.getElementById('detailUpvoteNote');
  btn.disabled = true;
  try {
    const res = await fetch(`/api/issues/${currentReport._id}/upvote`, {
      method: 'POST',
      headers: authHeader()
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) throw new Error(data.message || 'Failed to upvote');
    currentReport = data.issue || currentReport;
    document.getElementById('mdLikes').textContent = currentReport.upvoteCount || currentReport.upvotes?.length || 0;
    btn.textContent = 'Already Upvoted';
    note.textContent = 'Your upvote is already counted.';
    showToast('Upvote recorded successfully!', 'success');
    loadNearbyIssues();
    loadMyReports();
  } catch (error) {
    btn.disabled = false;
    showToast(error.message || 'Unable to upvote right now.', 'error');
  }
}

async function submitCitizenVerification(decision) {
  if (!currentReport) return;
  const satisfiedBtn = document.getElementById('citizenSatisfiedBtn');
  const notSatisfiedBtn = document.getElementById('citizenNotSatisfiedBtn');
  satisfiedBtn.disabled = true;
  notSatisfiedBtn.disabled = true;
  try {
    const res = await fetch(`/api/issues/${currentReport._id}/citizen-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ decision })
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) throw new Error(data.message || 'Failed to submit response');
    currentReport = data.issue || currentReport;
    showToast(
      decision === 'satisfied'
        ? 'Issue closed and reward credited.'
        : 'Issue reopened for another review cycle.',
      'success'
    );
    openDetailModal(currentReport);
    loadMyReports();
  } catch (error) {
    showToast(error.message || 'Could not submit your response.', 'error');
  } finally {
    satisfiedBtn.disabled = false;
    notSatisfiedBtn.disabled = false;
  }
}

// ─── Notifications ─────────────────────────────────────────────
function loadNotifications() {
  renderNotifDropdown();
  // Also update bottom notifications panel
  const list = document.getElementById('notificationsList');
  if (!list) return;
  list.innerHTML = '';
  NOTIFICATIONS.forEach(n => {
    const div = document.createElement('div');
    div.className = 'notif-item';
    div.innerHTML = `
      <div class="notif-icon ${n.type}">${n.icon}</div>
      <div class="notif-text"><strong>${n.title}</strong><p>${n.msg}</p></div>
      <span class="notif-time">${n.time}</span>
    `;
    list.appendChild(div);
  });
}

// ─── Profile Form ──────────────────────────────────────────────
async function saveProfile(e) {
  e.preventDefault();
  const btn = document.getElementById('pmSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const body = {
    name: document.getElementById('pmInputName').value,
    phone: document.getElementById('pmInputPhone').value,
    bio: document.getElementById('pmInputBio').value,
    city: document.getElementById('pmInputCity').value,
    state: document.getElementById('pmInputState').value
  };
  try {
    const res = await fetch('/api/users/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      showToast('✅ Profile updated successfully!', 'success');
      // Update stored user name
      const u = getUser();
      if (u) { u.name = body.name; localStorage.setItem('voiceup_user', JSON.stringify(u)); }
      document.getElementById('userName').textContent = 'Hi, ' + body.name.split(' ')[0];
      document.getElementById('userInitial').textContent = body.name.charAt(0).toUpperCase();
      document.getElementById('pmName').textContent = body.name;
      document.getElementById('pdName').textContent = body.name;
    } else { showToast('Failed to save. Try again.', 'error'); }
  } catch { showToast('Network error.', 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Save Changes'; }
}

// ─── DOMContentLoaded ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  initSocket();

  initCategoryButtons();
  initCharCounter();
  initImagePreview();

  // Feature 1: notification dropdown toggle
  document.getElementById('notifBtn')?.addEventListener('click', toggleNotifDropdown);
  document.getElementById('markAllReadBtn')?.addEventListener('click', e => {
    e.stopPropagation();
    NOTIFICATIONS.forEach(n => n.unread = false);
    renderNotifDropdown();
    showToast('All notifications marked as read', 'success');
  });

  // Feature 3: coins chip → wallet
  document.getElementById('coinsBadge')?.addEventListener('click', openWalletModal);
  document.getElementById('walletCloseBtn')?.addEventListener('click', closeWalletModal);
  document.getElementById('walletModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('walletModal')) closeWalletModal();
  });
  document.querySelectorAll('.redeem-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cost = parseInt(btn.dataset.cost);
      const store = btn.dataset.store;
      if (userCoins < cost) { showToast(`You need ${cost} VC to redeem this voucher.`, 'error'); return; }
      userCoins -= cost;
      updateCoinsDisplay(userCoins);
      showToast(`🎉 ${store} voucher redeemed! Check your email.`, 'success');
    });
  });

  // Feature 5: profile dropdown
  document.getElementById('userChip')?.addEventListener('click', toggleProfileDropdown);
  document.getElementById('pdMyProfile')?.addEventListener('click', openProfileModal);
  document.getElementById('pdMyRewards')?.addEventListener('click', () => { closeAllDropdowns(); openWalletModal(); });
  document.getElementById('pdSettings')?.addEventListener('click', () => { closeAllDropdowns(); showToast('Settings coming soon!', 'success'); });
  document.getElementById('pdLogout')?.addEventListener('click', () => { if (typeof logout === 'function') logout(); });

  // Feature 5: Reminder Button
  document.getElementById('sendReminderBtn')?.addEventListener('click', async () => {
    if (!currentReport) return;
    const btn = document.getElementById('sendReminderBtn');
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const res = await fetch(`/api/issues/${currentReport._id}/reminder`, {
        method: 'POST',
        headers: authHeader()
      });
      if (res.ok) {
        showToast('🚀 Reminder sent to officials!', 'success');
        document.getElementById('reminderCard').style.display = 'none';
      } else { showToast('Failed to send reminder.', 'error'); }
    } catch { showToast('Network error.', 'error'); }
    finally { btn.disabled = false; btn.textContent = orig; }
  });

  // Profile modal
  document.getElementById('profileCloseBtn')?.addEventListener('click', closeProfileModal);
  document.getElementById('profileModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('profileModal')) closeProfileModal();
  });
  document.getElementById('profileForm')?.addEventListener('submit', saveProfile);

  // Close all dropdowns on outside click
  document.addEventListener('click', closeAllDropdowns);

  // Detail modal close
  document.getElementById('modalCloseBtn')?.addEventListener('click', closeDetailModal);
  document.getElementById('detailModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('detailModal')) closeDetailModal();
  });
  document.getElementById('bcHome')?.addEventListener('click', closeDetailModal);
  document.getElementById('detailUpvoteBtn')?.addEventListener('click', handleDetailUpvote);
  document.getElementById('citizenSatisfiedBtn')?.addEventListener('click', () => submitCitizenVerification('satisfied'));
  document.getElementById('citizenNotSatisfiedBtn')?.addEventListener('click', () => submitCitizenVerification('not_satisfied'));

  // All Reports modal
  document.getElementById('viewAllReportsBtn')?.addEventListener('click', () => {
    const list = document.getElementById('allReportsList');
    renderReportsList(window.myIssues, list);
    document.getElementById('allReportsModal').classList.add('open');
  });
  const closeAllReportsModal = () => document.getElementById('allReportsModal').classList.remove('open');
  document.getElementById('allReportsCloseBtn')?.addEventListener('click', closeAllReportsModal);
  document.getElementById('allReportsModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('allReportsModal')) closeAllReportsModal();
  });

  // Reminder
  document.getElementById('sendReminderBtn')?.addEventListener('click', () => {
    showToast('✅ Reminder sent to officials!', 'success');
    document.getElementById('reminderCard').style.display = 'none';
  });

  // Get Location button
  const getLocationBtn = document.getElementById('getLocation');
  getLocationBtn?.addEventListener('click', () => {
    if (!navigator.geolocation) { showToast('Geolocation not supported', 'error'); return; }
    const orig = getLocationBtn.innerHTML;
    getLocationBtn.disabled = true; getLocationBtn.textContent = '⌛ Getting location…';
    navigator.geolocation.getCurrentPosition(
      pos => {
        const tryPlace = () => {
          if (!map) { setTimeout(tryPlace, 400); return; }
          const loc = new google.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
          map.setCenter(loc); map.setZoom(16);
          placeMarker(loc); reverseGeocode(loc, true);
          getLocationBtn.disabled = false; getLocationBtn.innerHTML = orig;
        };
        tryPlace();
      },
      err => { showToast('Could not get location: ' + err.message, 'error'); getLocationBtn.disabled = false; getLocationBtn.innerHTML = orig; },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  // Voice recording + Groq Whisper STT
  let mediaRecorder, audioChunks = [];
  let isRecording = false;
  const startBtn = document.getElementById('startRecord');
  const stopBtn = document.getElementById('stopRecord');
  const audio = document.getElementById('audioPlayback');

  startBtn?.addEventListener('click', async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });

      mediaRecorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks to release mic
        stream.getTracks().forEach(t => t.stop());

        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        if (blob.size < 100) {
          showToast('Recording too short. Try again.', 'error');
          return;
        }

        // Show playback
        audio.src = URL.createObjectURL(blob);
        audio.style.display = 'block';
        audio.load();

        // Send to Whisper for transcription
        startBtn.textContent = '🤖 Transcribing…';
        startBtn.disabled = true;
        try {
          const formData = new FormData();
          formData.append('audio', blob, 'recording.webm');

          const res = await fetch('/api/issues/transcribe', {
            method: 'POST',
            headers: authHeader(),
            body: formData
          });

          if (res.ok) {
    const data = await parseJsonSafe(res);
            const transcript = (data.text || '').trim();
            if (transcript) {
              // Auto-fill description initially
              const titleEl = document.getElementById('title');
              const descEl = document.getElementById('description');
              const catEl = document.getElementById('category'); // Ensure your HTML has an element with ID 'category' or similar category selection

              if (descEl) {
                descEl.value = transcript;
                const cc = document.getElementById('charCount');
                if (cc) cc.textContent = transcript.length;
              }

              startBtn.textContent = '🤖 Structuring details...';

              // Call the AI structure endpoint
              try {
                const structRes = await fetch('/api/issues/ai-structure', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...authHeader() },
                  body: JSON.stringify({ rawText: transcript })
                });

                if (structRes.ok) {
                  const structuredData = await structRes.json();

                  if (titleEl) titleEl.value = structuredData.title;
                  if (descEl) descEl.value = structuredData.description;

                  // Try to select category if it matches the radio buttons/select
                  if (structuredData.category) {
                    const catBtn = document.querySelector(`.cat-btn[data-val="${structuredData.category.toLowerCase()}"]`);
                    if (catBtn) {
                      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
                      catBtn.classList.add('active');
                      if (catEl) catEl.value = structuredData.category.toLowerCase();
                    }
                  }

                  showToast(`🤖 AI formatted your report!`, 'success');
                } else {
                  showToast(`🎙️ Voice transcribed (AI structurer failed)`, 'success');
                }
              } catch (e) {
                console.error("Structurer error", e);
                showToast(`🎙️ Voice transcribed!`, 'success');
              }

            } else {
              showToast('Could not understand audio. Try again.', 'error');
            }
          } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.message || 'Transcription failed.', 'error');
          }
        } catch (e) {
          showToast('Network error during transcription.', 'error');
          console.error('Transcribe error:', e);
        } finally {
          startBtn.textContent = '🎙️ Tap to Record';
          startBtn.disabled = false;
        }
      };

      mediaRecorder.start(250); // collect data every 250ms
      isRecording = true;
      startBtn.style.display = 'none';
      stopBtn.style.display = 'flex';
      showToast('🎙️ Recording… Speak now!', 'success');
    } catch (e) {
      showToast('Microphone error: ' + e.message, 'error');
    }
  });

  stopBtn?.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      isRecording = false;
    }
    stopBtn.style.display = 'none';
    startBtn.style.display = 'flex';
  });

  // Form submit
  const form = document.getElementById('issueForm');
  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const lat = document.getElementById('latitude').value;
    const lng = document.getElementById('longitude').value;
    if (!lat || !lng) { showToast('Please select a location on the map or use Detect Location', 'error'); return; }
    const body = {
      title: document.getElementById('title').value,
      description: document.getElementById('description').value,
      category: document.getElementById('category').value || document.querySelector('.cat-btn.active')?.dataset.cat || 'other',
      latitude: lat, longitude: lng,
      address: document.getElementById('locationAddress').textContent
    };
    const photoInput = document.getElementById('photo');
    if (photoInput.files && photoInput.files[0]) body.imageBase64 = await fileToBase64(photoInput.files[0]);
    const btn = document.getElementById('submitBtn');
    btn.disabled = true; btn.textContent = '🤖 Analyzing with AI…';
    showLoader(true);
    try {
      const res = await fetch('/api/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(body)
      });
      const json = await parseJsonSafe(res);
      if (res.ok) {
        // Track anonymously submitted issues locally
        if (json.id) {
          try {
            let anonIds = JSON.parse(localStorage.getItem('voiceup_anon_issues') || '[]');
            if (!anonIds.includes(json.id)) {
              anonIds.push(json.id);
              localStorage.setItem('voiceup_anon_issues', JSON.stringify(anonIds));
            }
          } catch (e) { }
        }
        showToast(`✅ Report submitted! AI Priority: ${json.priority || 'medium'}`, 'success');

        if (typeof json.coinsAwarded === 'number' && getToken()) {
          updateCoinsDisplay((userCoins || 0) + json.coinsAwarded);
        }

        // Show AI reason alert if available
        if (json.aiReason) {
          const priorityClass = json.priority === 'critical' ? 'critical' : json.priority === 'high' ? 'high' : 'medium';
          const modalHtml = `
            <div id="aiReasonModal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.8); z-index:9999; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(4px);">
              <div style="background:#1E293B; border: 1px solid rgba(139, 92, 246, 0.4); border-radius:16px; width:90%; max-width:400px; padding:24px; text-align:center; box-shadow:0 10px 25px rgba(0,0,0,0.5); animation: scaleIn 0.3s ease;">
                <div style="font-size:3rem; margin-bottom:12px;">🤖</div>
                <h3 style="color:white; margin:0 0 8px 0; font-size:1.2rem;">AI Classification Complete</h3>
                <div style="display:inline-block; padding:4px 12px; border-radius:50px; font-size:0.85rem; font-weight:700; margin-bottom:16px; text-transform:uppercase;" class="priority-badge ${priorityClass}">${json.priority} Priority</div>
                <p style="color:#94A3B8; font-size:0.95rem; line-height:1.5; margin-bottom:24px; text-align:left; background:rgba(0,0,0,0.2); padding:16px; border-radius:8px;">${json.aiReason}</p>
                <button id="aiReasonGotItBtn" style="background:#8B5CF6; color:white; border:none; padding:12px 24px; border-radius:8px; font-weight:600; width:100%; cursor:pointer;">Got it</button>
              </div>
            </div>
          `;
          document.body.insertAdjacentHTML('beforeend', modalHtml);
          document.getElementById('aiReasonGotItBtn').addEventListener('click', () => {
            document.getElementById('aiReasonModal').remove();
            loadMyReports();
            const reportsTab = document.querySelector('[data-page=reports]') || document.querySelectorAll('.bottom-nav a')[1];
            if (reportsTab) reportsTab.click();
          });
        } else {
          setTimeout(() => { loadMyReports(); showPage('reports', document.querySelector('[data-page=reports]') || document.querySelectorAll('.bottom-nav a')[1]); }, 100);
        }

        form.reset();
        document.getElementById('charCount').textContent = '0';
        document.getElementById('previewImg').style.display = 'none';
        const ph = document.getElementById('previewPlaceholder');
        if (ph) ph.style.display = 'block';
        if (marker) { marker.setMap(null); marker = null; }
        document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.cat-btn')?.classList.add('active');
      } else { showToast(json.message || 'Failed to submit report', 'error'); }
    } catch { showToast('Network error. Please try again.', 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Submit Report'; showLoader(false); }
  });

  // Load everything
  loadUserData();
  loadMyReports();
  loadNearbyIssues();
  loadNotifications();
});
