import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  runTransaction,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  writeBatch,
  collection,
  onSnapshot,
  addDoc,
  serverTimestamp,
  query,
  orderBy,
  where,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const days = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const sides = ["Attaque", "Défense"];
const roundResults = ["Gagné", "Perdu"];
// Map pool compétitif Rainbow Six Siege / circuit esport actuel.
const COMPETITIVE_MAPS = [
  "Banque",
  "Frontière",
  "Chalet",
  "Clubhouse",
  "Consulat",
  "Café Dostoyevsky",
  "Repaire",
  "Labo de Nighthaven",
  "Forteresse"
];
const MATCH_TYPES = ["Scrim", "Tournoi"];
const SIM_OPPONENTS = ["Team Alpha", "Team Bravo", "Night Wolves", "Blue Stack", "Phoenix", "Vortex", "Aegis", "Nova Five"];
const SITE_PRESETS = ["Bombe A/B", "CCTV", "Cash", "Kids", "Dortoir", "Garage", "Cuisine", "Archives", "Cafétéria", "Laboratoire", "Sous-sol", "Bar"];


let app, auth, db;
let currentUser = null;
let currentProfile = null;
let registeredUsers = [];
let teams = [];
let currentTeam = null;
let pendingRequests = [];
let players = [];
let matches = [];
let editingMatch = null;
let planningVersion = null;
let openStratImage = null;
let savingStratNotes = false;
let savingMatch = false;
let availability = {};
let planning = [];
let activityLog = [];
let strats = [];
let currentStratFolderId = "";
let imageZoom = 1;
let dataUnsubscribes = [];
let profileUnsubscribe = null;
let isRegistering = false;

const config = window.R6_FIREBASE_CONFIG || {};
const firebaseReady = Boolean(config.apiKey && config.projectId && config.appId);

if (!firebaseReady) {
  $("setupWarning").classList.remove("hidden");
} else {
  app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
  bindAuth();
}

function bindAuth() {
  $("loginBtn").addEventListener("click", login);
  $("registerBtn").addEventListener("click", register);
  $("showLoginPanelBtn")?.addEventListener("click", () => showAuthPanel("login"));
  $("showRegisterPanelBtn")?.addEventListener("click", () => showAuthPanel("register"));
  $("backFromLoginBtn")?.addEventListener("click", () => showAuthPanel("choice"));
  $("backFromRegisterBtn")?.addEventListener("click", () => showAuthPanel("choice"));
  document.querySelectorAll('input[name="registerMode"]').forEach((el) => el.addEventListener("change", updateRegisterMode));
  $("refreshTeamsBtn")?.addEventListener("click", renderTeamSelect);
  $("logoutBtn").addEventListener("click", () => signOut(auth));
  $("pendingLogoutBtn")?.addEventListener("click", () => signOut(auth));
  $("noTeamLogoutBtn")?.addEventListener("click", () => signOut(auth));
  $("createTeamExistingBtn")?.addEventListener("click", createTeamForCurrentUser);
  $("requestJoinExistingBtn")?.addEventListener("click", requestJoinTeamForCurrentUser);
  $("leaveTeamBtn")?.addEventListener("click", leaveCurrentTeam);
  $("deleteTeamBtn")?.addEventListener("click", deleteCurrentTeam);
  $("themeToggleBtn")?.addEventListener("click", toggleTheme);
  $("notificationBtn")?.addEventListener("click", toggleNotificationPanel);
  $("markNotificationsReadBtn")?.addEventListener("click", markNotificationsRead);
  $("addStratFolderBtn")?.addEventListener("click", addStratFolder);
  $("addStratImageBtn")?.addEventListener("click", () => $("stratImageInput")?.click());
  $("stratImageInput")?.addEventListener("change", handleStratImageUpload);
  $("closeImageModalBtn")?.addEventListener("click", closeImageModal);
  $("saveStratNotesBtn")?.addEventListener("click", saveStratNotes);
  $("zoomInBtn")?.addEventListener("click", () => setImageZoom(imageZoom + 0.25));
  $("zoomOutBtn")?.addEventListener("click", () => setImageZoom(imageZoom - 0.25));
  $("zoomResetBtn")?.addEventListener("click", () => setImageZoom(1));
  initTheme();
  subscribeTeamsPublic();
  updateRegisterMode();
  $("saveAvailabilityBtn").addEventListener("click", saveAvailability);
  $("availabilityTableWrap")?.addEventListener("change", refreshAvailabilityColors);
  $("availabilityTableWrap")?.addEventListener("click", handleAvailabilityStatusClick);
  $("addMatchBtn").addEventListener("click", addMatch);
  $("cancelEditMatchBtn")?.addEventListener("click", () => { resetMatchEditor(); setMsg("matchMsg", "Modification annulée."); });
  $("addRandomMatchBtn")?.addEventListener("click", addRandomMatch);
  $("savePlayerBtn").addEventListener("click", savePlayer);
  $("addPlanningRowBtn")?.addEventListener("click", () => addPlanningRow());
  $("savePlanningBtn")?.addEventListener("click", savePlanning);
  $("clearPlanningBtn")?.addEventListener("click", clearPlanning);
  $("reloadPlanningBtn")?.addEventListener("click", () => { if (confirm("Recharger le planning et abandonner ce brouillon ?")) { renderPlanning(true); setMsg("planningMsg", "Dernier planning rechargé."); } });
  $("statsPeriodFilter")?.addEventListener("change", renderAllStats);
  $("statsModeFilter")?.addEventListener("change", renderAllStats);
  populateAdminSelects();
  $("addRoundBtn")?.addEventListener("click", () => addRoundRow());
  $("clearRoundsBtn")?.addEventListener("click", () => { $("roundsWrap").innerHTML = ""; });

  document.querySelectorAll(".tabs button").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (isRegistering) return;
    if (!user) {
      clearProfileSubscription();
      clearDataSubscriptions();
      showLogin();
      return;
    }
    await loadProfile(user);
    startProfileSubscription(user);
    if (hasNoTeam()) {
      showNoTeam();
      return;
    }
    if (["pending", "rejected"].includes(currentProfile?.role)) {
      showPending();
      return;
    }
    showMain();
    subscribeData();
  });
}


function showAuthPanel(panel) {
  const choice = $("authChoiceView");
  const loginPanel = $("loginPanel");
  const registerPanel = $("registerPanel");
  choice?.classList.toggle("hidden", panel !== "choice");
  loginPanel?.classList.toggle("hidden", panel !== "login");
  registerPanel?.classList.toggle("hidden", panel !== "register");
  if (panel === "register") renderTeamSelect();
  setMsg("loginMsg", "");
}

function subscribeTeamsPublic() {
  if (!db) return;
  onSnapshot(query(collection(db, "teams"), orderBy("name", "asc")), (snap) => {
    teams = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderTeamSelect();
  }, (err) => console.warn("Liste équipes non chargée", err));
}

function updateRegisterMode() {
  const mode = document.querySelector('input[name="registerMode"]:checked')?.value || "create";
  $("createTeamBlock")?.classList.toggle("hidden", mode !== "create");
  $("joinTeamBlock")?.classList.toggle("hidden", mode !== "join");
  renderTeamSelect();
}

function renderTeamSelect() {
  const selects = [$("teamSelect"), $("noTeamSelect")].filter(Boolean);
  if (!selects.length) return;
  const html = !teams.length
    ? `<option value="">Aucune équipe créée pour le moment</option>`
    : teams.map((t) => `<option value="${escapeAttr(t.id)}">${escapeHtml(t.name || "Équipe")}</option>`).join("");
  selects.forEach((sel) => { sel.innerHTML = html; });
}

async function pseudoExistsInTeam(pseudo, teamId, excludeUid = "") {
  const normalized = String(pseudo || "").trim().toLowerCase();
  if (!normalized || !teamId) return false;
  const snap = await getDocs(query(collection(db, "users"), where("teamId", "==", teamId)));
  return snap.docs.some((d) => {
    const data = d.data() || {};
    const role = data.role || "pending";
    const status = data.status || "pending";
    if (d.id === excludeUid) return false;
    if (role === "rejected" || status === "rejected") return false;
    return String(data.name || "").trim().toLowerCase() === normalized;
  });
}

function requestDocId(teamId, uid) {
  return `${teamId}_${uid}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function login() {
  setMsg("loginMsg", "Connexion...");
  try {
    await signInWithEmailAndPassword(auth, $("emailInput").value.trim(), $("passwordInput").value);
    setMsg("loginMsg", "");
  } catch (err) {
    isRegistering = false;
    setMsg("loginMsg", humanError(err));
  }
}

async function register() {
  const pseudo = $("pseudoInput").value.trim();
  const email = ($("registerEmailInput")?.value || "").trim().toLowerCase();
  const password = $("registerPasswordInput")?.value || "";
  const mode = document.querySelector('input[name="registerMode"]:checked')?.value || "create";
  const teamName = $("teamNameInput")?.value.trim();
  const teamIdToJoin = $("teamSelect")?.value || "";

  if (!pseudo || pseudo.length > 80) {
    setMsg("loginMsg", "Entre un pseudo joueur de 1 à 80 caractères.");
    return;
  }
  if (mode === "create" && !teamName) {
    setMsg("loginMsg", "Entre le nom de ton équipe.");
    return;
  }
  if (mode === "join" && !teamIdToJoin) {
    setMsg("loginMsg", "Choisis l’équipe à rejoindre.");
    return;
  }

  // Important : on ne vérifie pas les pseudos ici, car la personne n'est pas
  // encore connectée. Les règles Firestore refusent la lecture de /users
  // avant authentification. Le contrôle anti-doublon se fait côté admin au
  // moment d'accepter la demande.

  setMsg("loginMsg", mode === "join" ? "Création du compte et envoi de la demande..." : "Création du compte...");
  isRegistering = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: pseudo });

    if (mode === "create") {
      const teamRef = await addDoc(collection(db, "teams"), {
        name: teamName,
        ownerUid: cred.user.uid,
        ownerName: pseudo,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      const profile = {
        uid: cred.user.uid,
        email: cred.user.email,
        name: pseudo,
        role: "admin",
        teamId: teamRef.id,
        teamName,
        status: "active",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      await setDoc(doc(db, "users", cred.user.uid), profile, { merge: true });
      currentUser = cred.user;
      currentProfile = profile;
      currentTeam = { id: teamRef.id, name: teamName, ownerUid: cred.user.uid, ownerName: pseudo };
      startProfileSubscription(cred.user);
      isRegistering = false;
      setMsg("loginMsg", "Compte créé. Tu es admin de ton équipe.");
      showMain();
      subscribeData();
    } else {
      // Rejoindre une équipe : on relit l'équipe directement depuis Firestore
      // pour éviter un problème si la liste locale n'était pas encore chargée.
      const teamSnap = await getDoc(doc(db, "teams", teamIdToJoin));
      if (!teamSnap.exists()) {
        throw new Error("Équipe introuvable. Clique sur Actualiser puis réessaie.");
      }
      const team = { id: teamSnap.id, ...teamSnap.data() };
      const profile = {
        uid: cred.user.uid,
        email: cred.user.email,
        name: pseudo,
        role: "pending",
        teamId: teamIdToJoin,
        teamName: team?.name || "Équipe",
        status: "pending",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      const request = {
        uid: cred.user.uid,
        name: pseudo,
        requestedName: pseudo,
        teamId: teamIdToJoin,
        teamName: team?.name || "Équipe",
        status: "pending",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      await setDoc(doc(db, "users", cred.user.uid), profile, { merge: true });
      // Nouvelle demande avec un ID unique : cela permet de refaire une demande
      // après avoir quitté/refusé une équipe, sans être bloqué par l'ancien
      // document teamRequests déjà marqué accepted/rejected.
      await addDoc(collection(db, "teamRequests"), request);
      currentUser = cred.user;
      currentProfile = profile;
      currentTeam = { id: teamIdToJoin, name: team?.name || "Équipe", ownerUid: team?.ownerUid || "" };
      startProfileSubscription(cred.user);
      isRegistering = false;
      setMsg("loginMsg", "Demande envoyée à l’admin de l’équipe.");
      showPending();
    }
  } catch (err) {
    isRegistering = false;
    setMsg("loginMsg", humanError(err));
  }
}

async function loadProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    currentProfile = { ...snap.data(), uid: user.uid };
  } else {
    currentProfile = { uid: user.uid, email: user.email, name: user.displayName || guessName(user.email), role: "pending", status: "pending" };
    await setDoc(ref, { ...currentProfile, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
  }

  // Sécurité : si le compte est marqué en attente mais qu'il est propriétaire de son équipe,
  // on le repasse automatiquement admin. Cela corrige les créations d'équipe interrompues
  // par le chargement automatique Firebase.
  if ((currentProfile.role === "pending" || currentProfile.status === "pending") && currentProfile.teamId) {
    const teamSnap = await getDoc(doc(db, "teams", currentProfile.teamId));
    if (teamSnap.exists() && teamSnap.data().ownerUid === user.uid) {
      currentProfile.role = "admin";
      currentProfile.status = "active";
      currentProfile.teamName = teamSnap.data().name || currentProfile.teamName || "Mon équipe";
      await setDoc(ref, { role: "admin", status: "active", teamName: currentProfile.teamName, updatedAt: serverTimestamp() }, { merge: true });
    }
  }

  // Migration douce pour un ancien compte admin sans équipe.
  if (["admin", "player", "viewer"].includes(currentProfile.role) && !currentProfile.teamId) {
    const teamRef = await addDoc(collection(db, "teams"), {
      name: currentProfile.role === "admin" ? "Mon équipe" : `Équipe de ${currentProfile.name || "joueur"}`,
      ownerUid: user.uid,
      ownerName: currentProfile.name || "Admin",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    currentProfile.teamId = teamRef.id;
    currentProfile.teamName = "Mon équipe";
    currentProfile.status = "active";
    await setDoc(ref, { teamId: teamRef.id, teamName: currentProfile.teamName, status: "active", updatedAt: serverTimestamp() }, { merge: true });
  }
  currentTeam = currentProfile.teamId ? (teams.find((t) => t.id === currentProfile.teamId) || { id: currentProfile.teamId, name: currentProfile.teamName || "Mon équipe" }) : null;
}

function clearProfileSubscription() {
  if (profileUnsubscribe) {
    try { profileUnsubscribe(); } catch (_) {}
  }
  profileUnsubscribe = null;
}

function startProfileSubscription(user) {
  if (!db || !user) return;
  clearProfileSubscription();
  profileUnsubscribe = onSnapshot(doc(db, "users", user.uid), (snap) => {
    if (!snap.exists() || !currentUser || currentUser.uid !== user.uid) return;
    const nextProfile = { ...snap.data(), uid: user.uid };
    const previousTeamId = currentProfile?.teamId || "";
    const previousRole = currentProfile?.role || "";
    const previousStatus = currentProfile?.status || "";
    currentProfile = nextProfile;
    currentTeam = currentProfile.teamId
      ? (teams.find((t) => t.id === currentProfile.teamId) || { id: currentProfile.teamId, name: currentProfile.teamName || "Mon équipe" })
      : null;

    if (hasNoTeam()) {
      clearDataSubscriptions();
      showNoTeam();
      return;
    }
    if (["pending", "rejected"].includes(currentProfile?.role) || ["pending", "rejected"].includes(currentProfile?.status)) {
      clearDataSubscriptions();
      showPending();
      return;
    }

    const needsResubscribe = previousTeamId !== currentProfile.teamId || previousRole !== currentProfile.role || previousStatus !== currentProfile.status;
    showMain();
    if (needsResubscribe || !dataUnsubscribes.length) subscribeData();
  }, (err) => console.warn("Profil non synchronisé", err));
}

function hasNoTeam() {
  return !currentProfile?.teamId || currentProfile?.role === "none" || currentProfile?.status === "no_team";
}

function showLogin() {
  currentProfile = null;
  currentTeam = null;
  $("loginView").classList.remove("hidden");
  $("pendingView")?.classList.add("hidden");
  $("noTeamView")?.classList.add("hidden");
  $("mainView").classList.add("hidden");
  $("logoutBtn").classList.add("hidden");
  $("notificationBtn")?.classList.add("hidden");
  $("notificationPanel")?.classList.add("hidden");
  $("userInfo").textContent = "Non connecté";
  showAuthPanel("choice");
}

function showMain() {
  $("loginView").classList.add("hidden");
  $("pendingView")?.classList.add("hidden");
  $("noTeamView")?.classList.add("hidden");
  $("mainView").classList.remove("hidden");
  $("logoutBtn").classList.remove("hidden");
  $("notificationBtn")?.classList.remove("hidden");
  $("userInfo").textContent = `${currentProfile.name || "Compte connecté"} — ${roleLabel(currentProfile.role)} — ${currentTeam?.name || currentProfile.teamName || "Équipe"}`;
  $("roleText").textContent = `Ton rôle : ${roleLabel(currentProfile.role)} dans ${currentTeam?.name || currentProfile.teamName || "ton équipe"}.`;
  $("adminTab").classList.toggle("hidden", currentProfile.role !== "admin");
  $("historyTabBtn")?.classList.toggle("hidden", currentProfile.role !== "admin");
  $("teamMemberActions")?.classList.toggle("hidden", currentProfile.role === "admin");
  $("stratAdminActions")?.classList.toggle("hidden", currentProfile.role !== "admin");
}

function showPending() {
  $("loginView").classList.add("hidden");
  $("mainView").classList.add("hidden");
  $("noTeamView")?.classList.add("hidden");
  $("pendingView")?.classList.remove("hidden");
  $("logoutBtn").classList.add("hidden");
  $("notificationBtn")?.classList.add("hidden");
  $("notificationPanel")?.classList.add("hidden");
  const isRejected = currentProfile?.role === "rejected";
  $("userInfo").textContent = `${currentProfile?.name || "Compte connecté"} — ${roleLabel(currentProfile?.role)}`;
  if ($("pendingText")) {
    $("pendingText").textContent = isRejected
      ? "Ta demande d’accès a été refusée. Contacte un admin si c’est une erreur."
      : `Ta demande pour rejoindre ${currentProfile?.teamName || "cette équipe"} est en attente. L’admin de l’équipe doit accepter ton accès avant que tu puisses utiliser le site.`;
  }
}


function showNoTeam() {
  clearDataSubscriptions();
  currentTeam = null;
  $("loginView").classList.add("hidden");
  $("pendingView")?.classList.add("hidden");
  $("mainView").classList.add("hidden");
  $("noTeamView")?.classList.remove("hidden");
  $("logoutBtn").classList.remove("hidden");
  $("notificationBtn")?.classList.remove("hidden");
  $("userInfo").textContent = `${currentProfile?.name || "Compte connecté"} — Sans équipe`;
  renderTeamSelect();
}

async function createTeamForCurrentUser() {
  if (!currentUser || !db) return;
  const teamName = $("noTeamNameInput")?.value.trim();
  if (!teamName) {
    setMsg("noTeamMsg", "Entre le nom de ton équipe.");
    return;
  }
  try {
    const teamRef = await addDoc(collection(db, "teams"), {
      name: teamName,
      ownerUid: currentUser.uid,
      ownerName: currentProfile?.name || currentUser.displayName || guessName(currentUser.email),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    await setDoc(doc(db, "users", currentUser.uid), {
      role: "admin",
      status: "active",
      teamId: teamRef.id,
      teamName,
      updatedAt: serverTimestamp()
    }, { merge: true });
    currentProfile = { ...currentProfile, role: "admin", status: "active", teamId: teamRef.id, teamName };
    currentTeam = { id: teamRef.id, name: teamName, ownerUid: currentUser.uid };
    setMsg("noTeamMsg", "Équipe créée. Tu es admin.");
    showMain();
    subscribeData();
  } catch (err) {
    setMsg("noTeamMsg", humanError(err));
  }
}

async function requestJoinTeamForCurrentUser() {
  if (!currentUser || !db) return;
  const teamIdToJoin = $("noTeamSelect")?.value || "";
  if (!teamIdToJoin) {
    setMsg("noTeamMsg", "Choisis l’équipe à rejoindre.");
    return;
  }
  try {
    const teamSnap = await getDoc(doc(db, "teams", teamIdToJoin));
    if (!teamSnap.exists()) {
      setMsg("noTeamMsg", "Cette équipe n’existe plus.");
      return;
    }
    const team = { id: teamSnap.id, ...teamSnap.data() };
    const name = currentProfile?.name || currentUser.displayName || guessName(currentUser.email);
    await setDoc(doc(db, "users", currentUser.uid), {
      name,
      role: "pending",
      status: "pending",
      teamId: teamIdToJoin,
      teamName: team.name || "Équipe",
      updatedAt: serverTimestamp()
    }, { merge: true });
    // On crée toujours une nouvelle demande avec un ID unique.
    // Ancien bug : l'ancien document team_uid existait déjà en accepted/rejected,
    // donc une nouvelle demande faisait un update interdit par les règles Firestore
    // et l'admin ne voyait aucune notification.
    await addDoc(collection(db, "teamRequests"), {
      uid: currentUser.uid,
      name,
      requestedName: name,
      teamId: teamIdToJoin,
      teamName: team.name || "Équipe",
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    currentProfile = { ...currentProfile, role: "pending", status: "pending", teamId: teamIdToJoin, teamName: team.name || "Équipe" };
    currentTeam = { id: teamIdToJoin, name: team.name || "Équipe", ownerUid: team.ownerUid || "" };
    showPending();
  } catch (err) {
    setMsg("noTeamMsg", humanError(err));
  }
}

function teamCollection(name) {
  return collection(db, "teams", currentProfile.teamId, name);
}

function teamDoc(collectionName, docId) {
  return doc(db, "teams", currentProfile.teamId, collectionName, docId);
}

function clearDataSubscriptions() {
  closeImageModal(true);
  planningVersion = null;
  resetMatchEditor();
  dataUnsubscribes.forEach((fn) => {
    try { fn(); } catch (_) {}
  });
  dataUnsubscribes = [];
  registeredUsers = [];
  players = [];
  pendingRequests = [];
  matches = [];
  availability = {};
  if ($("availabilityTableWrap")) $("availabilityTableWrap").dataset.availabilityContext = "";
  if ($("planningWrap")) $("planningWrap").dataset.planningContext = "";
  if ($("matchPlayersWrap")) $("matchPlayersWrap").dataset.matchContext = "";
  planning = [];
  activityLog = [];
  strats = [];
  currentStratFolderId = "";
}

function subscribeData() {
  clearDataSubscriptions();
  if (!currentProfile?.teamId) return;

  const usersQuery = currentProfile.role === "admin"
    ? query(collection(db, "users"), where("teamId", "==", currentProfile.teamId))
    : query(collection(db, "users"), where("teamId", "==", currentProfile.teamId), where("status", "==", "active"));
  const unsubUsers = onSnapshot(usersQuery, (snap) => {
    const allUsers = snap.docs.map((d) => ({ ...d.data(), id: d.id, uid: d.id }));
    const self = allUsers.find((u) => u.uid === currentUser?.uid);
    if (self && (self.teamId !== currentProfile.teamId || self.status === "no_team" || self.role === "none" || !self.teamId)) {
      currentProfile = { ...currentProfile, ...self };
      showNoTeam();
      return;
    }
    registeredUsers = allUsers.filter((u) => u.teamId === currentProfile.teamId && (currentProfile.role === "admin" || u.status === "active"));
    players = registeredUsers
      .filter((u) => ["admin", "player"].includes(u.role || "pending"))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "fr"));
    renderPlayers();
    renderNotifications();
    renderMatchPlayerInputs();
    renderAvailability();
    renderSummary();
    renderPlanning();
    renderAllStats();
  });
  dataUnsubscribes.push(unsubUsers);

  if (currentProfile.role === "admin") {
    const unsubRequests = onSnapshot(query(collection(db, "teamRequests"), where("teamId", "==", currentProfile.teamId)), (snap) => {
      const byUid = new Map();
      snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((r) => r.teamId === currentProfile.teamId && (r.status || "pending") === "pending")
        .forEach((r) => {
          if (!r.uid) return;
          const user = registeredUsers.find((u) => u.uid === r.uid);
          // La demande garde le pseudo choisi au moment de l'inscription.
          // On ne remplace pas ce pseudo par celui d'un autre document pour éviter
          // les doublons ou les changements de nom inattendus.
          const merged = { ...r, name: r.requestedName || r.name || user?.name || "Joueur", email: user?.email || r.email || "" };
          const previous = byUid.get(r.uid);
          const currentTime = merged.createdAt?.toMillis ? merged.createdAt.toMillis() : 0;
          const previousTime = previous?.createdAt?.toMillis ? previous.createdAt.toMillis() : -1;
          if (!previous || currentTime >= previousTime) byUid.set(r.uid, merged);
        });
      pendingRequests = Array.from(byUid.values()).sort((a, b) => {
        const da = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const dbb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return dbb - da;
      });
      renderPlayers();
      renderNotifications();
    });
    dataUnsubscribes.push(unsubRequests);
  }

  const unsubAvailability = onSnapshot(teamDoc("availability", "week"), (snap) => {
    availability = snap.exists() ? (snap.data().values || {}) : {};
    if (!snap.metadata?.hasPendingWrites) renderAvailability();
    renderSummary();
  });
  dataUnsubscribes.push(unsubAvailability);

  const unsubPlanning = onSnapshot(teamDoc("planning", "week"), (snap) => {
    planning = snap.exists() ? (snap.data().items || []) : [];
    planningVersion = snap.exists() ? JSON.parse(JSON.stringify(snap.data())) : null;
    renderPlanning();
  });
  dataUnsubscribes.push(unsubPlanning);

  const unsubMatches = onSnapshot(query(teamCollection("matches"), orderBy("date", "desc")), (snap) => {
    matches = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMatches();
    renderAllStats();
  });
  dataUnsubscribes.push(unsubMatches);

  const unsubStrats = onSnapshot(query(teamCollection("strats"), orderBy("createdAt", "asc")), (snap) => {
    strats = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderStrats();
    syncOpenStratNotes();
  });
  dataUnsubscribes.push(unsubStrats);

  const unsubLog = onSnapshot(query(teamCollection("activityLog"), orderBy("createdAt", "desc"), limit(80)), (snap) => {
    activityLog = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderActivityLog();
    renderNotifications();
  });
  dataUnsubscribes.push(unsubLog);
}

function switchTab(tab) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  const id = tab === "admin" ? "adminTabPanel" : `${tab}Tab`;
  $(id).classList.add("active");
}


function availabilityStatusClass(status) {
  if (status === "Dispo") return "status-dispo";
  if (status === "À confirmer") return "status-confirm";
  if (status === "Indispo") return "status-indispo";
  return "status-empty";
}

function refreshAvailabilityColors() {
  document.querySelectorAll("#availabilityTableWrap td.availability-cell").forEach((td) => {
    const statusInput = td.querySelector('[data-field="status"]');
    const status = statusInput ? statusInput.value : "";
    td.classList.remove("status-dispo", "status-confirm", "status-indispo", "status-empty");
    td.classList.add(availabilityStatusClass(status));
    if (statusInput?.classList?.contains("availability-select")) {
      statusInput.classList.remove("status-dispo", "status-confirm", "status-indispo", "status-empty");
      statusInput.classList.add(availabilityStatusClass(status));
    }
  });
}

function handleAvailabilityStatusClick(event) {
  // Ancien système de boutons conservé sans effet si absent.
  const btn = event.target.closest(".availability-status-btn");
  if (!btn || btn.disabled) return;
  const cell = btn.closest("td.availability-cell");
  const statusInput = cell?.querySelector('[data-field="status"]');
  if (!cell || !statusInput) return;
  statusInput.value = statusInput.value === btn.dataset.status ? "" : (btn.dataset.status || "");
  refreshAvailabilityColors();
}

function renderAvailability() {
  if (!$("availabilityTableWrap")) return;
  const wrap = $("availabilityTableWrap");
  const context = JSON.stringify([currentProfile?.teamId, currentUser?.uid, currentProfile?.role]);
  const sameContext = wrap.dataset.availabilityContext === context;
  const keyOf = (el) => JSON.stringify([el.dataset.player, el.dataset.day, el.dataset.field]);
  const drafts = new Map();
  if (sameContext) wrap.querySelectorAll("[data-player]").forEach((el) => {
    if (!el.disabled && el.dataset.syncedValue !== undefined && el.value !== el.dataset.syncedValue) {
      drafts.set(keyOf(el), el.value);
    }
  });
  const structure = JSON.stringify(players.map(p => [safeKey(p.uid || p.email || p.name || p.id), p.name, p.email, p.uid]));
  if (sameContext && wrap.dataset.availabilityStructure === structure) {
    wrap.querySelectorAll("[data-player]").forEach((el) => {
      const remote = String(availability?.[el.dataset.player]?.[el.dataset.day]?.[el.dataset.field] || "");
      // Preserve the element, focus and unsaved input while other people edit.
      if (!drafts.has(keyOf(el)) && el.value !== remote) el.value = remote;
      el.dataset.syncedValue = remote;
    });
    refreshAvailabilityColors();
    return;
  }
  const canEditAll = currentProfile?.role === "admin";
  const canEditOwn = currentProfile?.role === "player";
  const currentEmail = (currentProfile?.email || currentUser?.email || "").toLowerCase();

  let html = `<table><thead><tr><th>Joueur</th>${days.map(d => `<th>${d}</th>`).join("")}</tr></thead><tbody>`;
  for (const player of players) {
    const playerKey = safeKey(player.uid || player.email || player.name || player.id);
    const ownsLine = (player.uid && player.uid === currentUser?.uid) || (currentEmail && (player.email || "").toLowerCase() === currentEmail);
    const editable = canEditAll || (canEditOwn && ownsLine);
    html += `<tr><th class="availability-player"><span>${escapeHtml(player.name || "Joueur")}</span></th>`;
    for (const day of days) {
      const cell = availability?.[playerKey]?.[day] || { status: "", note: "" };
      const statusClass = availabilityStatusClass(cell.status);
      html += `<td class="availability-cell ${statusClass}">
        <select class="availability-select ${statusClass}" data-player="${playerKey}" data-day="${day}" data-field="status" ${editable ? "" : "disabled"} aria-label="Disponibilité ${escapeAttr(player.name || "Joueur")} ${day}">
          <option value="" ${!cell.status ? "selected" : ""}>—</option>
          <option value="Dispo" ${cell.status === "Dispo" ? "selected" : ""}>Dispo</option>
          <option value="À confirmer" ${cell.status === "À confirmer" ? "selected" : ""}>À confirmer</option>
          <option value="Indispo" ${cell.status === "Indispo" ? "selected" : ""}>Indispo</option>
        </select>
        <input class="availability-note" data-player="${playerKey}" data-day="${day}" data-field="note" value="${escapeAttr(cell.note || "")}" placeholder="20h-23h" ${editable ? "" : "disabled"} />
      </td>`;
    }
    html += `</tr>`;
  }
  html += `</tbody></table>`;
  wrap.innerHTML = html;
  wrap.dataset.availabilityContext = context;
  wrap.dataset.availabilityStructure = structure;
  wrap.querySelectorAll("[data-player]").forEach((el) => {
    el.dataset.syncedValue = el.value;
    if (!el.disabled && drafts.has(keyOf(el))) el.value = drafts.get(keyOf(el));
  });
  refreshAvailabilityColors();
  $("saveAvailabilityBtn").disabled = !(canEditAll || canEditOwn);
}

async function saveAvailability() {
  const next = {};
  let changed = false;
  document.querySelectorAll("#availabilityTableWrap [data-player]").forEach((el) => {
    if (el.disabled || el.value === el.dataset.syncedValue) return;
    changed = true;
    const player = el.dataset.player;
    const day = el.dataset.day;
    const field = el.dataset.field;
    if (!next[player]) next[player] = {};
    if (!next[player][day]) next[player][day] = {};
    next[player][day][field] = el.value;
  });
  if (!changed) {
    setMsg("availabilityMsg", "Aucune modification à enregistrer.");
    return;
  }
  try {
    await setDoc(teamDoc("availability", "week"), { values: next, updatedAt: serverTimestamp() }, { merge: true });
    await logActivity("availability", "Disponibilités mises à jour");
    setMsg("availabilityMsg", "Disponibilités enregistrées pour tout le monde.");
  } catch (err) {
    setMsg("availabilityMsg", humanError(err));
  }
}

function renderSummary() {
  const counts = {};
  days.forEach((d) => counts[d] = 0);
  for (const player of players) {
    const key = safeKey(player.uid || player.email || player.name || player.id);
    for (const day of days) {
      if (availability?.[key]?.[day]?.status === "Dispo") counts[day] += 1;
    }
  }
  $("availabilitySummary").innerHTML = days.map((d) => {
    const count = counts[d];
    const cls = players.length && count === players.length ? "summary-good" : count > 0 ? "summary-mid" : "summary-empty";
    return `<div class="item availability-summary-card ${cls}"><strong>${d}</strong><span>${count} / ${players.length} dispos</span></div>`;
  }).join("");
}

function renderMatchPlayerInputs(reset = false) {
  const wrap = $("matchPlayersWrap");
  if (!wrap) return;
  const context = JSON.stringify([currentProfile?.teamId, currentUser?.uid]);
  const sameContext = wrap.dataset.matchContext === context;
  const existingRows = Array.from(wrap.querySelectorAll("[data-stat-row]"));
  if (!reset && sameContext && JSON.stringify(existingRows.map(r => r.dataset.uid)) === JSON.stringify(matchEditorPlayers().map(p => p.uid))) {
    existingRows.forEach((row, i) => {
      row.dataset.name = matchEditorPlayers()[i].name || "Joueur";
      row.querySelector("strong").textContent = matchEditorPlayers()[i].name || "Joueur";
    });
    return;
  }
  const drafts = new Map();
  if (!reset && sameContext) existingRows.forEach(row => {
    drafts.set(row.dataset.uid, Array.from(row.querySelectorAll("[data-stat]")).map(el => [el.dataset.stat, el.type === "checkbox" ? el.checked : el.value]));
  });
  wrap.dataset.matchContext = context;
  if (!matchEditorPlayers().length) {
    wrap.innerHTML = `<p class="muted">Aucun joueur inscrit. Les joueurs apparaissent après création de compte.</p>`;
    return;
  }
  wrap.innerHTML = `<table class="stats-input compact-player-stats"><thead><tr><th>Présent</th><th>Joueur</th><th>Kills</th><th>Headshots</th><th>Morts</th><th>Assists</th><th>Entry K</th><th>Entry D</th><th>Plants</th><th>Defuses</th><th>Clutches</th></tr></thead><tbody>
    ${matchEditorPlayers().map((p) => {
      const key = safeKey(p.uid);
      return `<tr data-stat-row="${key}" data-uid="${escapeAttr(p.uid)}" data-name="${escapeAttr(p.name || "Joueur")}">
        <td><input class="small-check" type="checkbox" data-stat="present" checked></td>
        <td><strong>${escapeHtml(p.name || "Joueur")}</strong></td>
        <td><input type="number" min="0" value="0" data-stat="kills"></td>
        <td><input type="number" min="0" value="0" data-stat="headshots"></td>
        <td><input type="number" min="0" value="0" data-stat="deaths"></td>
        <td><input type="number" min="0" step="1" value="0" data-stat="assists"></td>
        ${["entryKills", "entryDeaths", "plants", "defuses", "clutches"].map(field => `<td><input type="number" min="0" step="1" value="0" data-stat="${field}"></td>`).join("")}
      </tr>`;
    }).join("")}
  </tbody></table>
  <p class="muted small-note">Sans rounds détaillés : saisis les totaux Entry K / D, plants, defuses et clutches ici. Avec des rounds : ces cinq compteurs sont recalculés depuis les rounds uniquement, les totaux manuels sont ignorés. Premier kill et première mort de notre équipe peuvent être renseignés dans un même round.</p>`;
  wrap.querySelectorAll("[data-stat-row]").forEach(row => {
    for (const [field, value] of drafts.get(row.dataset.uid) || []) {
      const el = row.querySelector(`[data-stat="${field}"]`);
      if (el.type === "checkbox") el.checked = value; else el.value = value;
    }
  });
}

function playerOptions(selected = "") {
  const opts = [`<option value="">-</option>`].concat(matchEditorPlayers().map((p) => {
    const value = p.uid;
    return `<option value="${escapeAttr(value)}" ${selected === value ? "selected" : ""}>${escapeHtml(p.name || "Joueur")}</option>`;
  }));
  return opts.join("");
}

function addRoundRow(data = {}) {
  const wrap = $("roundsWrap");
  if (!wrap) return;
  const index = wrap.querySelectorAll(".round-card").length + 1;
  const div = document.createElement("div");
  div.className = "round-card";
  div.innerHTML = `
    <div class="round-head">
      <strong>Round ${index}</strong>
      <button type="button" class="danger mini" data-remove-round>Supprimer</button>
    </div>
    <div class="grid three compact">
      <div><label>Numéro</label><input type="number" min="1" value="${escapeAttr(data.number || index)}" data-round="number"></div>
      <div><label>Côté</label><select data-round="side">${sides.map(s => `<option value="${s}" ${data.side === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      <div><label>Résultat</label><select data-round="result">${roundResults.map(r => `<option value="${r}" ${data.result === r ? "selected" : ""}>${r}</option>`).join("")}</select></div>
      <div><label>Premier kill</label><select data-round="firstKillUid">${playerOptions(data.firstKillUid || "")}</select></div>
      <div><label>Première mort</label><select data-round="firstDeathUid">${playerOptions(data.firstDeathUid || "")}</select></div>
      <div><label>Plant</label><select data-round="plantUid">${playerOptions(data.plantUid || "")}</select></div>
      <div><label>Defuse</label><select data-round="defuseUid">${playerOptions(data.defuseUid || "")}</select></div>
      <div><label>Clutch</label><select data-round="clutchUid">${playerOptions(data.clutchUid || "")}</select></div>
      <div><label>Site objectif</label><input type="text" value="${escapeAttr(data.site || "")}" placeholder="CCTV, Kids..." data-round="site"></div>
    </div>
    <label>Notes round</label><input type="text" value="${escapeAttr(data.notes || "")}" placeholder="Erreur, strat, info utile..." data-round="notes">
  `;
  div.querySelector("[data-remove-round]").addEventListener("click", () => div.remove());
  wrap.appendChild(div);
}

function collectPlayerStats() {
  const out = {};
  document.querySelectorAll("#matchPlayersWrap [data-stat-row]").forEach((row) => {
    const present = row.querySelector('[data-stat="present"]').checked;
    if (!present) return;
    const uid = row.dataset.uid;
    out[uid] = {
      uid,
      name: row.dataset.name,
      kills: num(row.querySelector('[data-stat="kills"]').value),
      headshots: num(row.querySelector('[data-stat="headshots"]')?.value),
      deaths: num(row.querySelector('[data-stat="deaths"]').value),
      assists: num(row.querySelector('[data-stat="assists"]').value),
      // Calculés automatiquement depuis les rounds (plantUid / defuseUid).
      plants: num(row.querySelector('[data-stat="plants"]')?.value),
      defuses: num(row.querySelector('[data-stat="defuses"]')?.value),
      entryKills: num(row.querySelector('[data-stat="entryKills"]')?.value),
      entryDeaths: num(row.querySelector('[data-stat="entryDeaths"]')?.value),
      clutches: num(row.querySelector('[data-stat="clutches"]')?.value)
    };
  });
  return out;
}

function collectRounds() {
  return [...document.querySelectorAll("#roundsWrap .round-card")].map((card) => {
    const get = (field) => card.querySelector(`[data-round="${field}"]`)?.value || "";
    return {
      number: num(get("number")),
      side: get("side"),
      result: get("result"),
      firstKillUid: get("firstKillUid"),
      firstDeathUid: get("firstDeathUid"),
      plantUid: get("plantUid"),
      defuseUid: get("defuseUid"),
      clutchUid: get("clutchUid"),
      site: get("site").trim(),
      notes: get("notes").trim()
    };
  }).filter((r) => r.number || r.firstKillUid || r.firstDeathUid || r.notes);
}

function enrichStatsWithRounds(playerStats, rounds) {
  if (!rounds.length) return playerStats;
  for (const stat of Object.values(playerStats)) {
    for (const field of ["entryKills", "entryDeaths", "plants", "defuses", "clutches"]) stat[field] = 0;
  }
  for (const round of rounds) {
    for (const [event, counter] of [["firstKillUid", "entryKills"], ["firstDeathUid", "entryDeaths"], ["plantUid", "plants"], ["defuseUid", "defuses"], ["clutchUid", "clutches"]]) {
      if (round[event] && playerStats[round[event]]) playerStats[round[event]][counter] += 1;
    }
  }
  return playerStats;
}

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function safeVodUrl(value) {
  const text = String(value || "").trim();
  if (!/^https?:\/\//i.test(text)) return "";
  try { const url = new URL(text); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : ""; } catch { return ""; }
}

function validateMatchInput(stats, rounds) {
  const date = $("matchDate").value;
  const parsed = new Date(`${date}T12:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || localDateString(parsed) !== date) return "Renseigne une date de match valide.";
  if (date > localDateString()) return "La date du match ne peut pas être dans le futur.";
  const rawTeam = $("matchTeamScore").value, rawEnemy = $("matchEnemyScore").value;
  const team = Number(rawTeam), enemy = Number(rawEnemy);
  if (rawTeam === "" || rawEnemy === "" || !Number.isInteger(team) || !Number.isInteger(enemy) || team < 0 || enemy < 0 || team + enemy === 0) return "Renseigne les deux scores avec des entiers positifs ou nuls (au moins un round).";
  const expected = team > enemy ? "Victoire" : team < enemy ? "Défaite" : "Nul";
  if ($("matchResult").value !== expected) return `Le score correspond à ${expected.toLowerCase()} : corrige le résultat ou les scores.`;
  const vod = $("matchVodUrl").value.trim();
  if (vod && !safeVodUrl(vod)) return "Le lien VOD doit être une adresse HTTP ou HTTPS valide, sans identifiants.";
  const seen = new Set();
  for (const round of rounds) {
    if (!Number.isInteger(round.number) || round.number < 1 || round.number > team + enemy || seen.has(round.number)) return "Les numéros de rounds doivent être entiers, uniques et compris dans le score total.";
    seen.add(round.number);
    for (const event of ["firstKillUid", "firstDeathUid", "plantUid", "defuseUid", "clutchUid"]) {
      if (round[event] && !stats[round[event]]) return `Round ${round.number} : le joueur sélectionné doit être coché présent.`;
    }
  }
  if (rounds.filter(r => r.result === "Gagné").length > team || rounds.filter(r => r.result === "Perdu").length > enemy) return "Les résultats des rounds contredisent le score. Corrige les rounds ou les scores.";
  let entriesK = 0, entriesD = 0;
  for (const stat of Object.values(stats)) {
    for (const field of ["kills", "headshots", "deaths", "assists", "entryKills", "entryDeaths", "plants", "defuses", "clutches"]) {
      if (!Number.isInteger(stat[field]) || stat[field] < 0) return "Les statistiques doivent être des entiers positifs ou nuls.";
    }
    if (stat.headshots > stat.kills) return `Les headshots de ${stat.name} dépassent ses kills.`;
    if (stat.deaths > team + enemy) return `Les morts de ${stat.name} dépassent le nombre de rounds.`;
    if (stat.entryKills > stat.kills || stat.entryDeaths > stat.deaths) return `Les Entry de ${stat.name} dépassent ses kills ou ses morts.`;
    if ([stat.plants, stat.defuses, stat.clutches].some(v => v > team + enemy)) return `Un compteur de ${stat.name} dépasse le nombre de rounds.`;
    entriesK += stat.entryKills; entriesD += stat.entryDeaths;
  }
  if (entriesK > team + enemy || entriesD > team + enemy) return "Le total des premiers kills ou des premières morts de l’équipe dépasse le nombre de rounds.";
  return "";
}


function populateAdminSelects() {
  const mapSelect = $("matchMap");
  if (mapSelect) {
    mapSelect.innerHTML = COMPETITIVE_MAPS.map((m) => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join("");
  }
  const modeSelect = $("matchMode");
  if (modeSelect) {
    modeSelect.innerHTML = MATCH_TYPES.map((m) => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join("");
  }
}

async function addRandomMatch() {
  if (currentProfile.role !== "admin") return;
  if (!players.length) {
    setMsg("matchMsg", "Impossible de créer une simulation : aucun joueur inscrit.");
    return;
  }

  const selectedPlayers = pickRandomPlayers(players, Math.min(5, players.length));
  const win = Math.random() >= 0.42;
  const loserScore = randInt(0, 7);
  const overtime = loserScore >= 6;
  const teamScore = win ? (overtime ? 8 : 7) : loserScore;
  const enemyScore = win ? loserScore : (overtime ? 8 : 7);
  const result = win ? "Victoire" : "Défaite";
  const roundCount = Math.max(1, Math.min(teamScore + enemyScore, 15));
  const matchMap = pick(COMPETITIVE_MAPS);
  const mode = pick(MATCH_TYPES);

  const playerStats = {};
  for (const p of selectedPlayers) {
    const deaths = randInt(3, Math.max(4, roundCount));
    const kills = Math.max(0, Math.round(randInt(2, Math.max(5, roundCount + 2)) + (win ? 1 : 0)));
    playerStats[p.uid] = {
      uid: p.uid,
      name: p.name || "Joueur",
      kills,
      headshots: randInt(0, kills),
      deaths,
      assists: randInt(0, Math.max(2, Math.floor(roundCount / 2))),
      plants: 0,
      defuses: 0,
      entryKills: 0,
      entryDeaths: 0,
      clutches: 0
    };
  }

  const rounds = [];
  let wonRounds = 0;
  let lostRounds = 0;
  for (let i = 1; i <= roundCount; i++) {
    const mustWin = wonRounds < teamScore && (lostRounds >= enemyScore || Math.random() < (win ? 0.58 : 0.43));
    const won = mustWin && wonRounds < teamScore;
    if (won) wonRounds += 1; else lostRounds += 1;
    const firstKill = pick(selectedPlayers)?.uid || "";
    const firstDeath = pick(selectedPlayers.filter((p) => p.uid !== firstKill))?.uid || pick(selectedPlayers)?.uid || "";
    const plant = Math.random() < 0.18 ? pick(selectedPlayers)?.uid || "" : "";
    const defuse = Math.random() < 0.10 ? pick(selectedPlayers)?.uid || "" : "";
    const clutch = Math.random() < 0.08 ? pick(selectedPlayers)?.uid || "" : "";
    rounds.push({
      number: i,
      side: i <= Math.ceil(roundCount / 2) ? pick(sides) : pick(sides),
      result: won ? "Gagné" : "Perdu",
      firstKillUid: firstKill,
      firstDeathUid: firstDeath,
      plantUid: plant,
      defuseUid: defuse,
      clutchUid: clutch,
      site: pick(SITE_PRESETS),
      notes: "Simulation automatique"
    });
  }

  enrichStatsWithRounds(playerStats, rounds);
  for (const stat of Object.values(playerStats)) {
    stat.kills = Math.max(stat.kills, stat.entryKills);
    stat.deaths = Math.max(stat.deaths, stat.entryDeaths);
  }

  try {
    const matchRef = await addDoc(teamCollection("matches"), {
      date: localDateString(),
      opponent: pick(SIM_OPPONENTS),
      map: matchMap,
      mode,
      teamScore,
      enemyScore,
      score: `${teamScore}-${enemyScore}`,
      result,
      vodUrl: "",
      notes: "Match généré avec le bouton simulation.",
      playerStats,
      rounds,
      simulated: true,
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid
    });
    await logActivity("match", `Simulation ajoutée : ${matchMap} — ${result} ${teamScore}-${enemyScore}`, { matchId: matchRef.id });
    setMsg("matchMsg", `Simulation ajoutée : ${matchMap} — ${result} ${teamScore}-${enemyScore}.`);
  } catch (err) {
    setMsg("matchMsg", humanError(err));
  }
}

function pickRandomPlayers(list, maxCount) {
  const copy = [...list].sort(() => Math.random() - 0.5);
  const minCount = Math.min(copy.length, Math.min(5, Math.max(1, maxCount)));
  return copy.slice(0, minCount);
}
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// Compare Firestore maps by content, independent of their property order.
function matchFingerprint(data) {
  const canonical = value => {
    if (value === null || typeof value !== "object") return value;
    if (typeof value.toJSON === "function") return canonical(value.toJSON());
    if (Array.isArray(value)) return value.map(canonical);
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  };
  return JSON.stringify(canonical(data));
}

function matchEditorPlayers() {
  const list = [...players];
  for (const [uid, stat] of Object.entries(editingMatch?.data.playerStats || {})) {
    if (!list.some(p => p.uid === uid)) list.push({ uid, name: stat.name || "Ancien joueur" });
  }
  return list;
}

function resetMatchEditor() {
  editingMatch = null;
  if (!$("addMatchBtn")) return;
  $("addMatchBtn").textContent = "Ajouter le match complet";
  $("cancelEditMatchBtn")?.classList.add("hidden");
  $("addRandomMatchBtn")?.classList.remove("hidden");
  ["matchOpponent", "matchTeamScore", "matchEnemyScore", "matchVodUrl", "matchNotes"].forEach(id => $(id).value = "");
  $("roundsWrap").innerHTML = "";
  renderMatchPlayerInputs(true);
}

window.editMatch = (id) => {
  if (currentProfile?.role !== "admin" || savingMatch) return;
  const match = matches.find(m => m.id === id);
  if (!match) return;
  if (editingMatch && !confirm("Remplacer la modification en cours par ce match ?")) return;
  const { id: ignored, ...data } = match;
  editingMatch = { id, teamId: currentProfile.teamId, data: JSON.parse(JSON.stringify(data)) };
  const fields = { matchDate: "date", matchOpponent: "opponent", matchMap: "map", matchMode: "mode", matchTeamScore: "teamScore", matchEnemyScore: "enemyScore", matchResult: "result", matchVodUrl: "vodUrl", matchNotes: "notes" };
  for (const [id, field] of Object.entries(fields)) {
    const el = $(id), value = data[field] ?? "";
    if (el.tagName === "SELECT" && value && !Array.from(el.options).some(o => o.value === String(value))) {
      const option = document.createElement("option"); option.value = value; option.textContent = value; el.appendChild(option);
    }
    el.value = value;
  }
  renderMatchPlayerInputs(true);
  $("matchPlayersWrap").querySelectorAll("[data-stat-row]").forEach(row => {
    const stat = data.playerStats?.[row.dataset.uid];
    row.querySelector('[data-stat="present"]').checked = Boolean(stat);
    for (const field of ["kills", "headshots", "deaths", "assists", "entryKills", "entryDeaths", "plants", "defuses", "clutches"]) row.querySelector(`[data-stat="${field}"]`).value = stat?.[field] ?? 0;
  });
  $("roundsWrap").innerHTML = "";
  for (const round of data.rounds || []) addRoundRow(round);
  $("addMatchBtn").textContent = "Enregistrer les modifications";
  $("cancelEditMatchBtn").classList.remove("hidden");
  $("addRandomMatchBtn")?.classList.add("hidden");
  setMsg("matchMsg", "Modification du match : corrige les champs, puis enregistre.");
  switchTab("admin");
  $("matchDate").scrollIntoView?.({ behavior: "smooth", block: "center" });
};

async function addMatch() {
  if (currentProfile?.role !== "admin" || savingMatch) return;
  const rounds = collectRounds();
  const playerStats = enrichStatsWithRounds(collectPlayerStats(), rounds);
  if (!Object.keys(playerStats).length) {
    setMsg("matchMsg", "Coche au moins un joueur présent.");
    return;
  }
  const teamScore = num($("matchTeamScore").value);
  const enemyScore = num($("matchEnemyScore").value);
  const score = `${teamScore}-${enemyScore}`;
  const invalid = validateMatchInput(playerStats, rounds);
  if (invalid) { setMsg("matchMsg", invalid); return; }
  const edit = editingMatch;
  savingMatch = true;
  $("addMatchBtn").disabled = true;
  try {
    const payload = {
      date: $("matchDate").value,
      opponent: $("matchOpponent").value.trim(),
      map: $("matchMap").value.trim(),
      mode: $("matchMode").value.trim(),
      teamScore,
      enemyScore,
      score,
      result: $("matchResult").value,
      vodUrl: safeVodUrl($("matchVodUrl")?.value),
      notes: $("matchNotes").value.trim(),
      playerStats,
      rounds
    };
    let matchRef;
    if (edit) {
      if (edit.teamId !== currentProfile.teamId) throw new Error("L’équipe a changé. Rouvre le match.");
      matchRef = teamDoc("matches", edit.id);
      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(matchRef);
        if (!snapshot.exists()) throw new Error("Ce match a été supprimé. Annule la modification.");
        const latest = snapshot.data();
        if (matchFingerprint(latest) !== matchFingerprint(edit.data)) throw new Error("Ce match a été modifié par un autre admin. Annule puis rouvre le match pour récupérer sa version.");
        transaction.update(matchRef, { ...payload, updatedAt: serverTimestamp(), updatedBy: currentUser.uid });
      });
    } else {
      matchRef = await addDoc(teamCollection("matches"), { ...payload, createdAt: serverTimestamp(), createdBy: currentUser.uid });
    }
    await logActivity("match", `Match ${edit ? "modifié" : "ajouté"} : ${$("matchOpponent").value.trim() || "Adversaire"} — ${$("matchMap").value.trim() || "Map"}`, { matchId: matchRef.id });
    resetMatchEditor();
    setMsg("matchMsg", edit ? "Match modifié. Les statistiques sont recalculées automatiquement." : "Match complet ajouté. Les statistiques sont recalculées automatiquement.");
  } catch (err) {
    setMsg("matchMsg", humanError(err));
  } finally {
    savingMatch = false;
    $("addMatchBtn").disabled = false;
  }
}

function renderMatches() {
  $("matchList").innerHTML = matches.length ? matches.map((m) => {
    const statsRows = Object.values(m.playerStats || {}).sort((a, b) => String(a.name).localeCompare(String(b.name), "fr"));
    const rounds = Array.isArray(m.rounds) ? m.rounds : [];
    return `<div class="item match-card">
      <div class="item-head"><strong>${escapeHtml(m.date || "Sans date")} — ${escapeHtml(m.opponent || "Adversaire")}</strong><span>${escapeHtml(m.result || "")} ${escapeHtml(m.score || "")}</span></div>
      <p class="muted">Map : ${escapeHtml(m.map || "-")} ${m.mode ? `— ${escapeHtml(m.mode)}` : ""}</p>
      ${safeVodUrl(m.vodUrl) ? `<p><a class="vod-link" href="${escapeAttr(safeVodUrl(m.vodUrl))}" target="_blank" rel="noopener">Ouvrir la VOD / vidéo</a></p>` : ""}
      <details>
        <summary>Voir les stats du match</summary>
        <div class="table-wrap"><table><thead><tr><th>Joueur</th><th>K</th><th>HS</th><th>HS%</th><th>D</th><th>A</th><th>K/D</th><th>Entry K</th><th>Entry D</th><th>Plants</th><th>Defuses</th><th>Clutches</th></tr></thead><tbody>
          ${statsRows.map((s) => `<tr><td>${escapeHtml(s.name || "Joueur")}</td><td>${s.kills || 0}</td><td>${s.headshots || 0}</td><td>${hsPercent(s.headshots, s.kills)}</td><td>${s.deaths || 0}</td><td>${s.assists || 0}</td><td>${kd(s.kills, s.deaths)}</td><td>${s.entryKills || 0}</td><td>${s.entryDeaths || 0}</td><td>${s.plants || 0}</td><td>${s.defuses || 0}</td><td>${s.clutches || 0}</td></tr>`).join("")}
        </tbody></table></div>
        ${rounds.length ? `<h4>Rounds</h4><div class="table-wrap"><table><thead><tr><th>#</th><th>Côté</th><th>Résultat</th><th>Premier kill</th><th>Première mort</th><th>Plant</th><th>Defuse</th><th>Clutch</th><th>Site / notes</th></tr></thead><tbody>
          ${rounds.map((r) => `<tr><td>${r.number || ""}</td><td>${escapeHtml(r.side || "")}</td><td>${escapeHtml(r.result || "")}</td><td>${escapeHtml(nameByUid(r.firstKillUid))}</td><td>${escapeHtml(nameByUid(r.firstDeathUid))}</td><td>${escapeHtml(nameByUid(r.plantUid))}</td><td>${escapeHtml(nameByUid(r.defuseUid))}</td><td>${escapeHtml(nameByUid(r.clutchUid))}</td><td>${escapeHtml([r.site, r.notes].filter(Boolean).join(" — "))}</td></tr>`).join("")}
        </tbody></table></div>` : `<p class="muted">Aucun round détaillé saisi.</p>`}
      </details>
      ${m.notes ? `<p>${escapeHtml(m.notes)}</p>` : ""}
      ${currentProfile?.role === "admin" ? `<button class="secondary" onclick="window.editMatch('${m.id}')">Modifier</button> <button class="danger" onclick="window.deleteMatch('${m.id}')">Supprimer</button>` : ""}
    </div>`;
  }).join("") : `<p class="muted">Aucun match pour le moment.</p>`;
}

function filteredMatches() {
  const filter = $("statsPeriodFilter")?.value || "all";
  const mode = $("statsModeFilter")?.value || "all";
  const limit = new Date();
  limit.setHours(0, 0, 0, 0);
  if (filter !== "all") limit.setDate(limit.getDate() - Number(filter));
  return matches.filter((m) => {
    if (mode !== "all" && m.mode !== mode) return false;
    if (filter === "all") return true;
    if (!m.date) return false;
    const d = new Date(`${m.date}T00:00:00`);
    return Number.isFinite(d.getTime()) && d >= limit && m.date <= localDateString();
  });
}

function matchRoundCount(match) {
  const scoreRounds = num(match.teamScore) + num(match.enemyScore);
  return scoreRounds > 0 ? scoreRounds : (Array.isArray(match.rounds) ? match.rounds.length : 0);
}

function renderAllStats() {
  renderStatsTable();
  renderCharts();
  renderMapStats();
  renderRanking();
}

function calculateAggregates() {
  const sourceMatches = filteredMatches();
  const agg = {};
  for (const p of players) {
    agg[p.uid] = { uid: p.uid, name: p.name || "Joueur", matches: 0, roundsPlayed: 0, kprKills: 0, roundsMissing: 0, wins: 0, kills: 0, headshots: 0, deaths: 0, assists: 0, plants: 0, defuses: 0, entryKills: 0, entryDeaths: 0, clutches: 0 };
  }
  for (const m of sourceMatches) {
    for (const [uid, s] of Object.entries(m.playerStats || {})) {
      if (!agg[uid]) agg[uid] = { uid, name: s.name || nameByUid(uid), matches: 0, roundsPlayed: 0, kprKills: 0, roundsMissing: 0, wins: 0, kills: 0, headshots: 0, deaths: 0, assists: 0, plants: 0, defuses: 0, entryKills: 0, entryDeaths: 0, clutches: 0 };
      agg[uid].matches += 1;
      const roundCount = matchRoundCount(m);
      agg[uid].roundsPlayed += roundCount;
      if (roundCount > 0) agg[uid].kprKills += num(s.kills); else agg[uid].roundsMissing += 1;
      if (m.result === "Victoire") agg[uid].wins += 1;
      ["kills", "headshots", "deaths", "assists", "plants", "defuses", "entryKills", "entryDeaths", "clutches"].forEach((k) => agg[uid][k] += num(s[k]));
    }
  }
  return Object.values(agg).sort((a, b) => b.kills - a.kills || String(a.name).localeCompare(String(b.name), "fr"));
}

function renderStatsTable() {
  const wrap = $("statsTableWrap");
  if (!wrap) return;
  const rows = calculateAggregates();
  if (!rows.length) {
    wrap.innerHTML = `<p class="muted">Aucun joueur à afficher.</p>`;
    return;
  }
  wrap.innerHTML = `${rows.some(r => r.roundsMissing) ? `<p class="muted">* KPR partiel : seuls les matchs dont le nombre de rounds est connu sont utilisés. Complète les scores des anciens matchs.</p>` : ""}<table><thead><tr><th>Joueur</th><th>MJ</th><th>Win</th><th>K</th><th>HS</th><th>HS%</th><th>D</th><th>A</th><th>K/D</th><th>KPR</th><th>Entry K</th><th>Entry D</th><th>Plants</th><th>Defuses</th><th>Clutches</th></tr></thead><tbody>
    ${rows.map((r) => {
      const winRate = r.matches ? Math.round((r.wins / r.matches) * 100) : 0;
      const kpr = r.roundsPlayed ? (r.kprKills / r.roundsPlayed).toFixed(1) + (r.roundsMissing ? "*" : "") : "—";
      return `<tr><td><strong>${escapeHtml(r.name)}</strong></td><td>${r.matches}</td><td>${winRate}%</td><td>${r.kills}</td><td>${r.headshots}</td><td>${hsPercent(r.headshots, r.kills)}</td><td>${r.deaths}</td><td>${r.assists}</td><td>${kd(r.kills, r.deaths)}</td><td>${kpr}</td><td>${r.entryKills}</td><td>${r.entryDeaths}</td><td>${r.plants}</td><td>${r.defuses}</td><td>${r.clutches}</td></tr>`;
    }).join("")}
  </tbody></table>`;
}

function renderCharts() {
  const rows = calculateAggregates().filter((r) => r.matches > 0 || r.kills > 0 || r.deaths > 0 || r.assists > 0);
  renderRadarCharts(rows);
  renderBarChart("kdChart", rows.map((r) => ({ label: r.name, value: Number(kd(r.kills, r.deaths)) })), "x");
  renderBarChart("killsChart", rows.map((r) => ({ label: r.name, value: r.kills })), "K");
  renderBarChart("hsChart", rows.map((r) => ({ label: r.name, value: Number(hsPercentValue(r.headshots, r.kills)) })), "%");
  renderBarChart("entryChart", rows.map((r) => ({ label: r.name, value: r.entryKills - r.entryDeaths })), "diff");
  renderBarChart("winChart", rows.map((r) => ({ label: r.name, value: r.matches ? Math.round((r.wins / r.matches) * 100) : 0 })), "%");
}

function renderRadarCharts(rows) {
  const el = $("radarCharts");
  if (!el) return;
  if (!rows.length) {
    el.innerHTML = `<p class="chart-empty">Aucune donnée pour le moment.</p>`;
    return;
  }

  const prepared = rows.map((r) => {
    const kdValue = Number(kd(r.kills, r.deaths));
    const kpr = r.roundsPlayed ? r.kprKills / r.roundsPlayed : 0;
    const winRate = r.matches ? (r.wins / r.matches) * 100 : 0;
    const entryDiff = r.matches ? (r.entryKills - r.entryDeaths) / r.matches : 0;
    const objective = r.matches ? (r.plants + r.defuses) / r.matches : 0;
    const clutch = r.matches ? r.clutches / r.matches : 0;
    const hsRate = hsPercentValue(r.headshots, r.kills);
    return { ...r, kdValue, kpr, winRate, entryDiff, objective, clutch, hsRate };
  });

  const maxKpr = Math.max(1, ...prepared.map((r) => r.kpr));
  const maxObjective = Math.max(1, ...prepared.map((r) => r.objective));
  const maxClutch = Math.max(1, ...prepared.map((r) => r.clutch));

  el.innerHTML = prepared.map((r) => {
    const metrics = [
      { label: "K/D", value: clamp01(r.kdValue / 2) },
      { label: "KPR", value: clamp01(r.kpr / maxKpr) },
      { label: "HS%", value: clamp01(r.hsRate / 100) },
      { label: "Win", value: clamp01(r.winRate / 100) },
      { label: "Entry", value: clamp01((r.entryDiff + 1) / 2) },
      { label: "Objectif", value: clamp01(r.objective / maxObjective) },
      { label: "Clutch", value: clamp01(r.clutch / maxClutch) }
    ];
    return `<div class="radar-card">
      <h3>${escapeHtml(r.name)}</h3>
      ${radarSvg(metrics)}
      <div class="radar-mini-stats">
        <span>K/D <strong>${escapeHtml(r.kdValue.toFixed(2))}</strong></span>
        <span>Win <strong>${Math.round(r.winRate)}%</strong></span>
        <span>Entry <strong>${r.entryKills - r.entryDeaths}</strong></span>
        <span>HS <strong>${Math.round(r.hsRate)}%</strong></span>
      </div>
    </div>`;
  }).join("");
}

function radarSvg(metrics) {
  const size = 280;
  const center = size / 2;
  const radius = 92;
  const levels = [0.25, 0.5, 0.75, 1];
  const points = metrics.map((m, i) => radarPoint(center, radius * m.value, i, metrics.length));
  const polygon = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const levelPolygons = levels.map((lvl) => {
    const pts = metrics.map((_, i) => radarPoint(center, radius * lvl, i, metrics.length)).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    return `<polygon points="${pts}" class="radar-grid-line"></polygon>`;
  }).join("");
  const axes = metrics.map((m, i) => {
    const end = radarPoint(center, radius, i, metrics.length);
    const label = radarPoint(center, radius + 24, i, metrics.length);
    return `<line x1="${center}" y1="${center}" x2="${end.x.toFixed(1)}" y2="${end.y.toFixed(1)}" class="radar-axis"></line>
      <text x="${label.x.toFixed(1)}" y="${label.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" class="radar-label">${escapeHtml(m.label)}</text>`;
  }).join("");
  return `<svg class="radar-svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Graphique radar">
    ${levelPolygons}
    ${axes}
    <polygon points="${polygon}" class="radar-area"></polygon>
    ${points.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" class="radar-dot"></circle>`).join("")}
  </svg>`;
}

function radarPoint(center, radius, index, total) {
  const angle = (-Math.PI / 2) + (index * 2 * Math.PI / total);
  return { x: center + Math.cos(angle) * radius, y: center + Math.sin(angle) * radius };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function renderBarChart(id, data, suffix = "") {
  const el = $(id);
  if (!el) return;
  const cleaned = data
    .filter((d) => Number.isFinite(Number(d.value)))
    .sort((a, b) => Number(b.value) - Number(a.value));
  if (!cleaned.length) {
    el.innerHTML = `<p class="chart-empty">Aucune donnée pour le moment.</p>`;
    return;
  }
  const max = Math.max(1, ...cleaned.map((d) => Math.abs(Number(d.value))));
  el.innerHTML = cleaned.map((d) => {
    const value = Number(d.value);
    const width = value === 0 ? 0 : Math.max(4, Math.round((Math.abs(value) / max) * 100));
    const display = suffix === "x" ? value.toFixed(2) : suffix === "diff" ? `${value > 0 ? "+" : ""}${value}` : `${value}${suffix}`;
    return `<div class="chart-row"><div class="chart-label">${escapeHtml(d.label)}</div><div class="chart-track"><div class="chart-fill" style="width:${width}%;${suffix === "diff" ? `background:${value < 0 ? "#dc4444" : "#238b57"}` : ""}"></div></div><div class="chart-value">${escapeHtml(display)}</div></div>`;
  }).join("");
}

function statsPlayerName(uid) {
  const current = players.find(p => p.uid === uid);
  if (current) return current.name || "Joueur";
  for (const match of [...filteredMatches()].sort((a,b) => String(b.date).localeCompare(String(a.date)))) {
    if (match.playerStats?.[uid]?.name) return match.playerStats[uid].name;
  }
  return "Ancien joueur";
}

function renderMapStats() {
  const wrap = $("mapStatsWrap");
  if (!wrap) return;
  const maps = {};
  for (const m of filteredMatches()) {
    const mapName = (m.map || "Map non renseignée").trim() || "Map non renseignée";
    if (!maps[mapName]) {
      maps[mapName] = {
        map: mapName,
        matches: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        roundsWon: 0,
        roundsLost: 0,
        attackWon: 0,
        attackPlayed: 0,
        defenseWon: 0,
        defensePlayed: 0,
        plants: 0,
        defuses: 0,
        clutches: 0,
        entryKills: 0,
        entryDeaths: 0,
        playerKills: {}
      };
    }
    const row = maps[mapName];
    row.matches += 1;
    if (m.result === "Victoire") row.wins += 1;
    else if (m.result === "Défaite") row.losses += 1;
    else row.draws += 1;
    row.roundsWon += num(m.teamScore);
    row.roundsLost += num(m.enemyScore);

    for (const [uid, s] of Object.entries(m.playerStats || {})) {
      row.plants += num(s.plants);
      row.defuses += num(s.defuses);
      row.clutches += num(s.clutches);
      row.entryKills += num(s.entryKills);
      row.entryDeaths += num(s.entryDeaths);
      row.playerKills[uid] = (row.playerKills[uid] || 0) + num(s.kills);
    }

    for (const r of Array.isArray(m.rounds) ? m.rounds : []) {
      if (r.side === "Attaque") {
        row.attackPlayed += 1;
        if (r.result === "Gagné") row.attackWon += 1;
      }
      if (r.side === "Défense") {
        row.defensePlayed += 1;
        if (r.result === "Gagné") row.defenseWon += 1;
      }
    }
  }
  const rows = Object.values(maps).sort((a, b) => b.matches - a.matches || a.map.localeCompare(b.map, "fr"));
  if (!rows.length) {
    wrap.innerHTML = `<p class="muted">Aucune map à afficher.</p>`;
    return;
  }
  wrap.innerHTML = `<table class="map-stats-table advanced-map-table"><thead><tr><th>Map</th><th>Matchs</th><th>Win %</th><th>V-D-N</th><th>Rounds</th><th>Diff</th><th>Atk %</th><th>Def %</th><th>Plants</th><th>Defuses</th><th>Clutches</th><th>Entry diff</th><th>Top kill</th></tr></thead><tbody>
    ${rows.map((r) => {
      const winRate = r.matches ? Math.round((r.wins / r.matches) * 100) : 0;
      const roundDiff = r.roundsWon - r.roundsLost;
      const attackRate = r.attackPlayed ? `${Math.round((r.attackWon / r.attackPlayed) * 100)}%` : "-";
      const defenseRate = r.defensePlayed ? `${Math.round((r.defenseWon / r.defensePlayed) * 100)}%` : "-";
      const entryDiff = r.entryKills - r.entryDeaths;
      const top = Object.entries(r.playerKills).sort((a, b) => b[1] - a[1])[0];
      return `<tr><td class="map-name"><strong>${escapeHtml(r.map)}</strong></td><td>${r.matches}</td><td>${winRate}%</td><td>${r.wins}-${r.losses}-${r.draws}</td><td>${r.roundsWon}-${r.roundsLost}</td><td class="${roundDiff >= 0 ? "positive" : "negative"}">${roundDiff > 0 ? "+" : ""}${roundDiff}</td><td>${attackRate}</td><td>${defenseRate}</td><td>${r.plants}</td><td>${r.defuses}</td><td>${r.clutches}</td><td class="${entryDiff >= 0 ? "positive" : "negative"}">${entryDiff > 0 ? "+" : ""}${entryDiff}</td><td>${top ? `${escapeHtml(statsPlayerName(top[0]))} (${top[1]})` : "-"}</td></tr>`;
    }).join("")}
  </tbody></table>`;
}


function planningSignature(items) {
  return JSON.stringify(items.map(item => [item.day || "", item.time || "", item.type || "", item.title || "", item.map || "", item.notes || ""]));
}

function renderPlanning(force = false) {
  const wrap = $("planningWrap");
  if (!wrap) return;
  const isAdmin = currentProfile?.role === "admin";
  const context = JSON.stringify([currentProfile?.teamId, currentUser?.uid, currentProfile?.role]);
  if (isAdmin && !force && wrap.dataset.planningContext === context && wrap.dataset.planningBaseline !== undefined) {
    const local = planningSignature(readPlanningFromDom());
    const remote = planningSignature(planning);
    if (local === remote) {
      wrap.dataset.planningBaseline = remote;
      wrap.dataset.planningVersion = matchFingerprint(planningVersion);
      return;
    }
    if (local !== wrap.dataset.planningBaseline) {
      setMsg("planningMsg", "Une mise à jour a été reçue. Ton brouillon est conservé ; vérifie-le avant d’enregistrer.");
      return;
    }
  }
  wrap.dataset.planningContext = context;
  wrap.dataset.planningBaseline = planningSignature(planning);
  wrap.dataset.planningVersion = matchFingerprint(planningVersion);
  $("planningAdminActions")?.classList.toggle("hidden", !isAdmin);
  if (isAdmin) {
    if (!planning.length) {
      wrap.innerHTML = `<p class="muted">Aucune ligne de planning. Clique sur “+ Ajouter une ligne”.</p>`;
      return;
    }
    wrap.innerHTML = `<div class="planning-admin-list">${planning.map((item, i) => planningRowHtml(item, i)).join("")}</div>`;
    wrap.querySelectorAll("[data-remove-planning]").forEach((btn) => btn.addEventListener("click", () => {
      btn.closest(".planning-row")?.remove();
    }));
    return;
  }
  if (!planning.length) {
    wrap.innerHTML = `<p class="muted">Aucun planning publié pour cette semaine.</p>`;
    return;
  }
  const byDay = Object.fromEntries(days.map((d) => [d, []]));
  for (const item of planning) {
    const day = days.includes(item.day) ? item.day : days[0];
    byDay[day].push(item);
  }
  wrap.innerHTML = `<div class="planning-week">${days.map((day) => `<div class="planning-day"><h3>${day}</h3>${byDay[day].length ? byDay[day].map(planningCardHtml).join("") : `<p class="muted small">Rien de prévu</p>`}</div>`).join("")}</div>`;
}

function planningRowHtml(item = {}, index = 0) {
  return `<div class="planning-row" data-planning-row>

    <div>
      <label>Jour</label>
      <select data-plan="day">
        ${days.map((d) => `<option value="${d}" ${item.day === d ? "selected" : ""}>${d}</option>`).join("")}
      </select>
    </div>

    <div>
      <label>Heure</label>
      <input data-plan="time" type="time" value="${escapeAttr(item.time || "20:30")}">
    </div>

    <div>
      <label>Type</label>
      <select data-plan="type">
        <option value="Scrim" ${item.type === "Scrim" ? "selected" : ""}>Scrim</option>
        <option value="Tournoi" ${item.type === "Tournoi" ? "selected" : ""}>Tournoi</option>
        <option value="VOD" ${item.type === "VOD" ? "selected" : ""}>VOD</option>
        <option value="Entraînement" ${item.type === "Entraînement" ? "selected" : ""}>Entraînement</option>
        <option value="Strat" ${item.type === "Strat" ? "selected" : ""}>STRAT</option>
      </select>
    </div>

    <div>
      <label>Titre / adversaire</label>
      <input data-plan="title" value="${escapeAttr(item.title || "")}" placeholder="Ex: Scrim vs Team Alpha">
    </div>

    <div>
      <label>Map</label>
      <select data-plan="map">
        <option value="">-</option>
        ${COMPETITIVE_MAPS.map((m) => `<option value="${escapeAttr(m)}" ${item.map === m ? "selected" : ""}>${escapeHtml(m)}</option>`).join("")}
      </select>
    </div>

    <div>
      <label>Notes</label>
      <input data-plan="notes" value="${escapeAttr(item.notes || "")}" placeholder="RDV vocal, strats...">
    </div>

    <button type="button" class="danger mini" data-remove-planning>Supprimer</button>

  </div>`;
}

function planningCardHtml(item) {
  return `<div class="planning-event"><strong>${escapeHtml(item.time || "--:--")} — ${escapeHtml(item.type || "Planning")}</strong><br><span>${escapeHtml(item.title || "Sans titre")}</span>${item.map ? `<br><span class="muted">Map : ${escapeHtml(item.map)}</span>` : ""}${item.notes ? `<br><span class="muted">${escapeHtml(item.notes)}</span>` : ""}</div>`;
}

function addPlanningRow(item = {}) {
  const draftVersion = $("planningWrap")?.dataset.planningVersion;
  const draftBaseline = $("planningWrap")?.dataset.planningBaseline;
  planning = readPlanningFromDom();
  planning.push({ day: item.day || days[0], time: item.time || "20:30", type: item.type || "Scrim", title: item.title || "", map: item.map || "", notes: item.notes || "" });
  renderPlanning(true);
  if (draftVersion !== undefined) $("planningWrap").dataset.planningVersion = draftVersion;
  if (draftBaseline !== undefined) $("planningWrap").dataset.planningBaseline = draftBaseline;
}

function readPlanningFromDom() {
  const rows = [...document.querySelectorAll("#planningWrap [data-planning-row]")];
  if (!rows.length) return [];
  return rows.map((row) => {
    const get = (field) => row.querySelector(`[data-plan="${field}"]`)?.value || "";
    return { day: get("day"), time: get("time"), type: get("type"), title: get("title").trim(), map: get("map"), notes: get("notes").trim() };
  }).filter((item) => item.title || item.notes || item.map || item.time);
}

async function savePlanning() {
  if (currentProfile?.role !== "admin") return;
  try {
    const items = readPlanningFromDom().sort((a, b) => days.indexOf(a.day) - days.indexOf(b.day) || String(a.time).localeCompare(String(b.time)));
    const ref = teamDoc("planning", "week");
    const expected = $("planningWrap").dataset.planningVersion;
    await runTransaction(db, async transaction => {
      const latest = await transaction.get(ref);
      const version = latest.exists() ? latest.data() : null;
      if (expected !== undefined && matchFingerprint(version) !== expected) throw new Error("Le planning a changé depuis ton brouillon. Tes modifications sont conservées. Recharge le planning avant de réessayer.");
      transaction.set(ref, { items, updatedAt: serverTimestamp(), updatedBy: currentUser.uid }, { merge: true });
    });
    await logActivity("planning", `Planning mis à jour (${items.length} ligne${items.length > 1 ? "s" : ""})`);
    setMsg("planningMsg", "Planning enregistré. Les joueurs le voient directement.");
  } catch (err) {
    setMsg("planningMsg", humanError(err));
  }
}

async function clearPlanning() {
  if (currentProfile?.role !== "admin") return;
  if (!confirm("Vider le planning de la semaine ?")) return;
  try {
    const ref = teamDoc("planning", "week");
    const expected = $("planningWrap").dataset.planningVersion;
    await runTransaction(db, async transaction => {
      const snap = await transaction.get(ref);
      if (expected !== undefined && matchFingerprint(snap.exists() ? snap.data() : null) !== expected) throw new Error("Le planning a changé. Recharge-le avant de le vider.");
      transaction.set(ref, { items: [], updatedAt: serverTimestamp(), updatedBy: currentUser.uid }, { merge: true });
    });
    planning = [];
    renderPlanning(true);
    await logActivity("planning", "Planning vidé");
    setMsg("planningMsg", "Planning vidé.");
  } catch (err) {
    setMsg("planningMsg", humanError(err));
  }
}

function overallPlayerScores(rows) {
  const complete = rows.filter(r => r.matches > 0 && r.roundsPlayed > 0 && r.roundsMissing === 0);
  const maxRounds = Math.max(0, ...complete.map(r => r.roundsPlayed));
  const minRounds = Math.max(1, Math.ceil(maxRounds / 2));
  const eligible = complete.filter(r => r.roundsPlayed >= minRounds);
  const criteria = [
    [20, r => Number(kd(r.kills, r.deaths))],
    [20, r => r.kprKills / r.roundsPlayed],
    [15, r => r.assists / r.roundsPlayed],
    [15, r => (r.entryKills - r.entryDeaths) / r.roundsPlayed],
    [10, r => (r.plants + r.defuses) / r.roundsPlayed],
    [10, r => r.clutches / r.roundsPlayed],
    [5, r => hsPercentValue(r.headshots, r.kills)],
    [5, r => r.wins / r.matches]
  ];
  const bounds = criteria.map(([,get]) => {
    const values = eligible.map(get);
    return [Math.min(...values), Math.max(...values)];
  });
  const scores = eligible.map(row => {
    const weighted = criteria.reduce((sum, [weight, get], index) => {
      const [min,max] = bounds[index];
      const relative = max === min ? 0.5 : (get(row) - min) / (max - min);
      return sum + weight * relative;
    }, 0);
    const reliability = row.roundsPlayed / (row.roundsPlayed + 24);
    const score = Math.round((50 + (weighted - 50) * reliability) * 10) / 10;
    return { ...row, score };
  }).sort((a,b) => b.score - a.score || String(a.name).localeCompare(String(b.name), "fr"));
  return { scores, minRounds };
}

function overallRankingHtml(rows) {
  const {scores,minRounds} = overallPlayerScores(rows);
  const leaders = scores.filter(row => row.score === scores[0]?.score);
  const winner = leaders.length ? leaders.map(row => escapeHtml(row.name)).join(" / ") : "Données insuffisantes";
  return `<section class="overall-ranking">
    <div class="ranking-card overall-winner"><span>🏆 Meilleur joueur${leaders.length > 1 ? " — ex æquo" : ""}</span><strong>${winner}</strong><em>${leaders.length ? `${leaders[0].score.toFixed(1)} / 100` : "Complète les scores des matchs"}</em></div>
    <p class="muted">Score comparatif basé sur les données saisies, pour la période et le mode sélectionnés. ${scores.some(r => r.matches < 3) ? "Classement provisoire : moins de 3 matchs pour certains joueurs." : ""}</p>
    ${scores.length ? `<div class="table-wrap"><table><thead><tr><th>Joueur</th><th>Score / 100</th><th>Matchs</th><th>Rounds</th></tr></thead><tbody>${scores.map(row => `<tr><td>${escapeHtml(row.name)}</td><td>${row.score.toFixed(1)}</td><td>${row.matches}</td><td>${row.roundsPlayed}</td></tr>`).join("")}</tbody></table></div>` : ""}
    <details><summary>Comment est choisi le meilleur joueur ?</summary><p>K/D 20 %, KPR 20 %, assists par round 15 %, différence premiers kills / premières morts par round 15 %, plants + defuses par round 10 %, clutches par round 10 %, HS% 5 %, victoires 5 %.</p><p>Chaque critère est comparé aux autres joueurs éligibles (minimum = 0, maximum = 100 ; égalité = 50). Le score est rapproché de 50 quand le volume est faible : 50 + (score brut − 50) × rounds / (rounds + 24).</p><p>Il faut au moins ${minRounds} round(s), soit la moitié du maximum joué sur cette sélection, et un nombre de rounds connu pour tous ses matchs. Les autres joueurs restent visibles dans les statistiques. Les rounds non renseignés ne permettent pas de deviner les assists, Entry ou objectifs manquants : la qualité de la saisie influence le score. Ce score n’est pas une note officielle du jeu.</p></details>
  </section>`;
}

function renderRanking() {
  const wrap = $("rankingWrap");
  if (!wrap) return;
  const rows = calculateAggregates().filter((r) => r.matches > 0);
  if (!rows.length) {
    wrap.innerHTML = `<p class="muted">Aucun classement pour le moment.</p>`;
    return;
  }
  const best = (label, scorer, formatter = (v) => v) => {
    const sorted = [...rows].sort((a, b) => scorer(b) - scorer(a));
    const top = sorted[0];
    return `<div class="ranking-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(top.name)}</strong><em>${escapeHtml(formatter(scorer(top)))}</em></div>`;
  };
  wrap.innerHTML = overallRankingHtml(rows) + [
    best("Meilleur K/D", (r) => Number(kd(r.kills, r.deaths)), (v) => v.toFixed(2)),
    best("Plus de kills", (r) => r.kills, (v) => `${v} K`),
    best("Meilleur HS%", (r) => hsPercentValue(r.headshots, r.kills), (v) => `${Math.round(v)}%`),
    best("Meilleur win rate", (r) => r.matches ? Math.round((r.wins / r.matches) * 100) : 0, (v) => `${v}%`),
    best("Meilleur entry", (r) => r.entryKills - r.entryDeaths, (v) => `${v > 0 ? "+" : ""}${v}`),
    best("Objectif", (r) => r.plants + r.defuses, (v) => `${v} actions`),
    best("Clutch", (r) => r.clutches, (v) => `${v} clutch`)
  ].join("");
}

window.deleteMatch = async (id) => {
  if (currentProfile?.role !== "admin") return;
  if (!confirm("Supprimer ce match ?")) return;
  await deleteDoc(doc(db, "teams", currentProfile.teamId, "matches", id));
  await logActivity("match", "Match supprimé", { matchId: id });
};


async function leaveCurrentTeam() {
  if (!currentUser || !currentProfile?.teamId) return;
  if (currentProfile.role === "admin") {
    alert("Un admin ne peut pas quitter l’équipe ici. Utilise plutôt Supprimer l’équipe, ou mets un autre compte admin avant de partir.");
    return;
  }
  if (!confirm(`Quitter l’équipe ${currentTeam?.name || currentProfile.teamName || "actuelle"} ?`)) return;
  try {
    await setDoc(doc(db, "users", currentUser.uid), {
      role: "none",
      status: "no_team",
      teamId: "",
      teamName: "",
      updatedAt: serverTimestamp()
    }, { merge: true });
    currentProfile = { ...currentProfile, role: "none", status: "no_team", teamId: "", teamName: "" };
    showNoTeam();
    setMsg("noTeamMsg", "Tu as quitté l’équipe. Tu peux en créer une nouvelle ou demander à rejoindre une autre équipe.");
  } catch (err) {
    alert(humanError(err));
  }
}

async function deleteCurrentTeam() {
  if (!currentUser || currentProfile?.role !== "admin" || !currentProfile?.teamId) return;
  const teamName = currentTeam?.name || currentProfile.teamName || "cette équipe";
  const confirmation = prompt(`Pour supprimer définitivement ${teamName}, écris SUPPRIMER`);
  if (confirmation !== "SUPPRIMER") return;

  try {
    const teamId = currentProfile.teamId;
    await logActivity("team", `Équipe supprimée : ${teamName}`, { teamId });

    const usersSnap = await getDocs(query(collection(db, "users"), where("teamId", "==", teamId)));
    const reqSnap = await getDocs(query(collection(db, "teamRequests"), where("teamId", "==", teamId)));
    const matchesSnap = await getDocs(collection(db, "teams", teamId, "matches"));
    const logSnap = await getDocs(collection(db, "teams", teamId, "activityLog"));
    const stratSnap = await getDocs(collection(db, "teams", teamId, "strats"));
    const claimsSnap = await getDocs(collection(db, "teams", teamId, "nameClaims"));

    let batch = writeBatch(db);
    let count = 0;
    const commitIfNeeded = async () => {
      if (count >= 450) {
        await batch.commit();
        batch = writeBatch(db);
        count = 0;
      }
    };
    const addUpdate = async (ref, data) => { batch.set(ref, data, { merge: true }); count++; await commitIfNeeded(); };
    const addDelete = async (ref) => { batch.delete(ref); count++; await commitIfNeeded(); };

    for (const u of usersSnap.docs) {
      if (u.id === currentUser.uid) continue;
      await addUpdate(u.ref, { role: "none", status: "no_team", teamId: "", teamName: "", updatedAt: serverTimestamp() });
    }
    for (const r of reqSnap.docs) {
      await addUpdate(r.ref, { status: "team_deleted", handledBy: currentUser.uid, handledAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    await addDelete(doc(db, "teams", teamId, "availability", "week"));
    await addDelete(doc(db, "teams", teamId, "planning", "week"));
    for (const m of matchesSnap.docs) await addDelete(m.ref);
    for (const l of logSnap.docs) await addDelete(l.ref);
    for (const st of stratSnap.docs) await addDelete(st.ref);
    for (const claim of claimsSnap.docs) await addDelete(claim.ref);
    // Commit resource cleanup before removing the administrator or the team.
    if (count > 0) await batch.commit();
    const finalBatch = writeBatch(db);
    finalBatch.set(doc(db, "users", currentUser.uid), { role: "none", status: "no_team", teamId: "", teamName: "", updatedAt: serverTimestamp() }, { merge: true });
    finalBatch.delete(doc(db, "teams", teamId));
    await finalBatch.commit();

    currentProfile = { ...currentProfile, role: "none", status: "no_team", teamId: "", teamName: "" };
    currentTeam = null;
    showNoTeam();
    setMsg("noTeamMsg", "Équipe supprimée. Tous les membres ont été retirés de l’équipe.");
  } catch (err) {
    alert(humanError(err));
  }
}

async function reserveAndUpdateMember(uid, name, changes, requestId = "") {
  if (!name.trim() || name.length > 80) throw new Error("Le pseudo doit contenir de 1 à 80 caractères.");
  const teamId = currentProfile.teamId;
  const userRef = doc(db, "users", uid);
  const claimRef = doc(db, "teams", teamId, "nameClaims", nameClaimKey(name));
  const requestRef = requestId ? doc(db, "teamRequests", requestId) : null;
  await runTransaction(db, async transaction => {
    const userSnap = await transaction.get(userRef);
    const claimSnap = await transaction.get(claimRef);
    if (!userSnap.exists() || userSnap.data().teamId !== teamId) throw new Error("Le compte a changé d’équipe. Recharge la liste.");
    if (claimSnap.exists() && claimSnap.data().uid !== uid) {
      const other = await transaction.get(doc(db, "users", claimSnap.data().uid));
      if (other.exists() && other.data().teamId === teamId && ["admin", "player", "viewer"].includes(other.data().role) && nameClaimKey(other.data().name || "") === nameClaimKey(name)) throw new Error("Ce pseudo vient d’être utilisé par un autre membre.");
    }
    const member = userSnap.data();
    if (member.role === "admin" && changes.role && changes.role !== "admin") {
      const teamSnap = await transaction.get(doc(db, "teams", teamId));
      if (teamSnap.exists() && teamSnap.data().ownerUid === uid) throw new Error("Le propriétaire doit conserver son rôle administrateur.");
    }
    transaction.set(claimRef, { uid, name, updatedAt: serverTimestamp() });
    transaction.set(userRef, { ...changes, nameKey: nameClaimKey(name) }, { merge: true });
    if (requestRef) transaction.set(requestRef, { status: "accepted", handledBy: currentUser.uid, handledAt: serverTimestamp() }, { merge: true });
  });
}

function nameClaimKey(name) {
  return encodeURIComponent(String(name).normalize("NFKC").trim().toLowerCase());
}

function duplicatePseudo(name, excludeUid) {
  return registeredUsers.some(user => user.uid !== excludeUid && ["admin", "player", "viewer"].includes(user.role) && nameClaimKey(user.name || "") === nameClaimKey(name));
}

async function savePlayer() {
  if (currentProfile.role !== "admin") return;
  const name = $("newPlayerName").value.trim();
  const email = $("newPlayerEmail").value.trim().toLowerCase();
  const role = $("newPlayerRole").value;
  if (!name || !email) {
    setMsg("playerMsg", "Nom et email obligatoires.");
    return;
  }

  const account = registeredUsers.find((u) => (u.email || "").toLowerCase() === email);
  if (!account) {
    setMsg("playerMsg", "Ce compte n'existe pas encore. La personne doit d'abord créer son compte sur le site.");
    return;
  }

  const targetUid = account.uid || account.id;
  if (!["admin", "player", "viewer"].includes(role)) { setMsg("playerMsg", "Rôle invalide."); return; }
  if (duplicatePseudo(name, targetUid)) { setMsg("playerMsg", "Ce pseudo est déjà utilisé dans l’équipe."); return; }
  if (role !== "admin" && (targetUid === currentTeam?.ownerUid || (account.role === "admin" && registeredUsers.filter(u => u.role === "admin" && u.status !== "no_team").length <= 1))) {
    setMsg("playerMsg", "Le propriétaire et le dernier administrateur doivent conserver leurs droits admin."); return;
  }
  try {
    await reserveAndUpdateMember(targetUid, name, { name, role, updatedAt: serverTimestamp() });
    await logActivity("user", `Compte mis à jour : ${name} (${roleLabel(role)})`, { targetUid: account.uid || account.id });
    setMsg("playerMsg", "Compte mis à jour.");
    ["newPlayerName", "newPlayerEmail"].forEach((id) => $(id).value = "");
  } catch (err) {
    setMsg("playerMsg", humanError(err));
  }
}

function renderPlayers() {
  const playerHtml = players.map((p) => accountCard(p)).join("");
  const accessRequestsHtml = pendingRequests
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "fr"))
    .map((p) => accessRequestCard(p))
    .join("");
  const allAccountsHtml = registeredUsers
    .filter((u) => (u.role || "pending") !== "pending")
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "fr"))
    .map((p) => accountCard(p))
    .join("");
  $("playerList").innerHTML = playerHtml || `<p class="muted">Aucun joueur inscrit pour le moment.</p>`;
  if ($("accessRequestsList")) $("accessRequestsList").innerHTML = accessRequestsHtml || `<p class="muted">Aucune demande en attente pour cette équipe.</p>`;
  $("adminPlayerList").innerHTML = allAccountsHtml || `<p class="muted">Aucun compte accepté pour le moment.</p>`;
}

function accountCard(p) {
  return `<div class="item"><strong>${escapeHtml(p.name || "Joueur")}</strong><br><span class="badge ${p.role || "pending"}">${roleLabel(p.role || "pending")}</span></div>`;
}

function accessRequestCard(p) {
  const uid = escapeHtml(p.uid || "");
  return `<div class="item access-request">
    <strong>${escapeHtml(p.name || "Joueur")}</strong><br>
    <span class="badge pending">${roleLabel("pending")}</span>
    <div class="row access-actions">
      <button type="button" onclick="window.approveAccess('${uid}', 'player')">Accepter joueur</button>
      <button type="button" class="secondary" onclick="window.approveAccess('${uid}', 'viewer')">Accepter lecture seule</button>
      <button type="button" class="danger" onclick="window.rejectAccess('${uid}')">Refuser</button>
    </div>
  </div>`;
}

window.approveAccess = async (uid, role) => {
  if (currentProfile?.role !== "admin" || !uid) return;
  const req = pendingRequests.find((u) => u.uid === uid);
  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);
  const existingUser = userSnap.exists() ? userSnap.data() : {};
  // Le pseudo validé est celui demandé par le joueur. On évite d'utiliser
  // un nom potentiellement modifié ailleurs avant l'acceptation.
  const finalName = req?.requestedName || req?.name || existingUser.name || "Joueur";

  const duplicateName = registeredUsers.some((u) => {
    if (u.uid === uid) return false;
    if (!["admin", "player", "viewer"].includes(u.role || "")) return false;
    return nameClaimKey(u.name || "") === nameClaimKey(finalName);
  });
  if (duplicateName) {
    alert(`Le pseudo "${finalName}" est déjà utilisé dans cette équipe. Demande au joueur de recréer son compte avec un autre pseudo, ou modifie un des pseudos avant d’accepter.`);
    return;
  }

  try {
  await reserveAndUpdateMember(uid, finalName, {
    name: finalName,
    role,
    status: "active",
    teamId: currentProfile.teamId,
    teamName: currentTeam?.name || currentProfile.teamName || "Équipe",
    updatedAt: serverTimestamp()
  }, req?.id || "");
  await logActivity("user", `Demande acceptée : ${finalName} (${roleLabel(role)})`, { targetUid: uid });
  } catch (err) { setMsg("playerMsg", humanError(err)); alert(humanError(err)); }
};

window.rejectAccess = async (uid) => {
  if (currentProfile?.role !== "admin" || !uid) return;
  const req = pendingRequests.find((u) => u.uid === uid);
  if (!confirm(`Refuser la demande de ${req?.name || "ce compte"} ?`)) return;
  await setDoc(doc(db, "users", uid), { role: "rejected", status: "rejected", updatedAt: serverTimestamp() }, { merge: true });
  if (req?.id) await setDoc(doc(db, "teamRequests", req.id), { status: "rejected", handledBy: currentUser.uid, handledAt: serverTimestamp() }, { merge: true });
  await logActivity("user", `Demande refusée : ${req?.name || "Compte"}`, { targetUid: uid });
};


function notificationStorageKey() {
  return `r6_notifications_seen_${currentUser?.uid || "anonymous"}_${currentProfile?.teamId || "global"}`;
}

function getNotificationSeenAt() {
  return Number(localStorage.getItem(notificationStorageKey()) || "0");
}

function markNotificationsRead() {
  localStorage.setItem(notificationStorageKey(), String(Date.now()));
  renderNotifications();
}

function logMillis(item) {
  if (item?.createdAt?.toMillis) return item.createdAt.toMillis();
  if (item?.updatedAt?.toMillis) return item.updatedAt.toMillis();
  return 0;
}

function notificationIcon(type) {
  if (type === "match") return "🎯";
  if (type === "planning") return "📅";
  if (type === "strat") return "🗺️";
  if (type === "user") return "👤";
  if (type === "availability") return "✅";
  return "🔔";
}

function toggleNotificationPanel() {
  const panel = $("notificationPanel");
  if (!panel) return;
  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) renderNotifications();
}

function renderNotifications() {
  const btn = $("notificationBtn");
  const list = $("notificationList");
  if (!btn || !currentProfile?.teamId) return;
  const seenAt = getNotificationSeenAt();
  const pendingNotifs = currentProfile?.role === "admin" ? pendingRequests.map((r) => ({
    kind: "request",
    type: "user",
    message: `Nouvelle demande d’accès : ${r.name || "Joueur"}`,
    userName: r.name || "Joueur",
    createdAt: r.createdAt
  })) : [];
  const activityNotifs = activityLog
    .filter((a) => ["user", "planning", "match", "strat"].includes(a.type || ""))
    .map((a) => ({ kind: "activity", ...a }));
  const items = [...pendingNotifs, ...activityNotifs]
    .sort((a, b) => logMillis(b) - logMillis(a))
    .slice(0, 20);
  const unread = items.filter((n) => n.kind === "request" || logMillis(n) > seenAt).length;
  $("notificationCount").textContent = String(unread);
  btn.classList.toggle("has-notifications", unread > 0);
  if (!list) return;
  list.innerHTML = items.length ? items.map((n) => `<div class="notification-item ${n.kind === "request" || logMillis(n) > seenAt ? "unread" : ""}">
    <span class="notification-icon">${notificationIcon(n.type)}</span>
    <div><strong>${escapeHtml(n.message || "Notification")}</strong><br><span class="muted">${escapeHtml(n.userName || "Système")} — ${escapeHtml(formatLogDate(n.createdAt))}</span></div>
  </div>`).join("") : `<p class="muted">Aucune notification pour le moment.</p>`;
}

function currentStratItems() {
  return strats.filter((s) => (s.parentId || "") === (currentStratFolderId || ""));
}

function stratById(id) {
  return strats.find((s) => s.id === id);
}

function renderStrats() {
  const grid = $("stratGrid");
  const crumb = $("stratBreadcrumb");
  if (!grid || !crumb) return;
  const canEdit = currentProfile?.role === "admin";
  $("stratAdminActions")?.classList.toggle("hidden", !canEdit);

  const trail = [];
  let cursor = currentStratFolderId;
  const guard = new Set();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    const item = stratById(cursor);
    if (!item) break;
    trail.unshift(item);
    cursor = item.parentId || "";
  }
  crumb.innerHTML = `<button type="button" class="crumb-btn" onclick="window.openStratFolder('')">Stratégies</button>` + trail.map((item) => ` <span>/</span> <button type="button" class="crumb-btn" onclick="window.openStratFolder('${escapeAttr(item.id)}')">${escapeHtml(item.name)}</button>`).join("");

  const items = currentStratItems().sort((a, b) => {
    if ((a.type || "") !== (b.type || "")) return a.type === "folder" ? -1 : 1;
    return String(a.name || "").localeCompare(String(b.name || ""), "fr");
  });
  grid.innerHTML = items.length ? items.map((item) => item.type === "folder" ? stratFolderCard(item, canEdit) : stratImageCard(item, canEdit)).join("") : `<p class="muted">Aucune strat ici. ${canEdit ? "Crée un dossier ou importe une image." : ""}</p>`;
}

function stratFolderCard(item, canEdit) {
  return `<div class="strat-card strat-folder" onclick="window.openStratFolder('${escapeAttr(item.id)}')">
    <div class="strat-thumb folder-thumb">📁</div>
    <strong>${escapeHtml(item.name || "Dossier")}</strong>
    ${canEdit ? `<button type="button" class="danger small-btn" onclick="event.stopPropagation(); window.deleteStratItem('${escapeAttr(item.id)}')">Supprimer</button>` : ""}
  </div>`;
}

function stratImageCard(item, canEdit) {
  return `<div class="strat-card strat-image" onclick="window.openStratImage('${escapeAttr(item.id)}')">
    <div class="strat-thumb"><img src="${escapeAttr(item.imageData || "")}" alt="${escapeAttr(item.name || "Strat")}" /></div>
    <strong>${escapeHtml(item.name || "Image")}</strong>
    ${canEdit ? `<button type="button" class="danger small-btn" onclick="event.stopPropagation(); window.deleteStratItem('${escapeAttr(item.id)}')">Supprimer</button>` : ""}
  </div>`;
}

window.openStratFolder = (id) => {
  currentStratFolderId = id || "";
  renderStrats();
};

// Coordinates are fractions of the original image, independent of zoom and viewport.
let imageAnnotations = [];
let annotationTool = "select";
let selectedAnnotationId = "";
let annotationGesture = null;
let annotationUndo = [];
let annotationRedo = [];
let savingAnnotations = false;
const ANNOTATION_LIMIT = 80;
const ANNOTATION_MARGIN = 0.25;
const ANNOTATION_BOARD_SCALE = 1 + 2 * ANNOTATION_MARGIN;
const ANNOTATION_BYTES = 30000;

function annotationCopy(value) { return JSON.parse(JSON.stringify(value)); }
function annotationNumber(value) { return typeof value === "number" && Number.isFinite(value) && value >= -ANNOTATION_MARGIN && value <= 1 + ANNOTATION_MARGIN; }
function decodeAnnotations(raw) {
  const items = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(items) || items.length > ANNOTATION_LIMIT) throw new Error("Format d’annotations invalide.");
  const ids = new Set();
  for (const item of items) {
    if (!item || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) || ids.has(item.id)) throw new Error("Identifiant d’annotation invalide.");
    ids.add(item.id);
    if (!["text", "arrow"].includes(item.type) || !annotationNumber(item.x) || !annotationNumber(item.y) || !/^#[0-9a-fA-F]{6}$/.test(item.color)) throw new Error("Annotation invalide.");
    if (item.type === "text" && (typeof item.text !== "string" || !item.text.trim() || item.text.length > 1000 || !Number.isFinite(item.size) || item.size < 16 || item.size > 64)) throw new Error("Texte d’annotation invalide.");
    if (item.type === "arrow" && (!annotationNumber(item.x2) || !annotationNumber(item.y2))) throw new Error("Flèche invalide.");
  }
  return items.map(item => item.type === "text"
    ? { id:item.id, type:item.type, x:item.x, y:item.y, color:item.color, text:item.text, size:item.size }
    : { id:item.id, type:item.type, x:item.x, y:item.y, x2:item.x2, y2:item.y2, color:item.color });
}
function annotationsDirty() {
  return Boolean(openStratImage && (annotationGesture || JSON.stringify(imageAnnotations) !== openStratImage.annotationsBaseline));
}
function stratEditorDirty() { return stratNotesDirty() || annotationsDirty(); }
function canEditAnnotations() {
  return Boolean(openStratImage && currentProfile?.role === "admin" && currentProfile.teamId === openStratImage.teamId && !openStratImage.annotationsError && !savingAnnotations);
}
function selectedAnnotation() { return imageAnnotations.find(item => item.id === selectedAnnotationId); }
function annotationCheckpoint(before = imageAnnotations) {
  const previous = JSON.stringify(before);
  if (annotationUndo.at(-1) !== previous) annotationUndo.push(previous);
  if (annotationUndo.length > 30) annotationUndo.shift();
  annotationRedo = [];
}
function setAnnotationTool(tool) {
  if (!canEditAnnotations() || annotationGesture || !["select", "text", "arrow"].includes(tool)) return;
  annotationTool = tool;
  if (tool !== "select") selectedAnnotationId = "";
  annotationGesture = null;
  updateAnnotationControls();
}
function annotationPoint(event) {
  const rect = $("stratCanvas").getBoundingClientRect();
  const fromBoard = (position, start, length) => Math.max(-ANNOTATION_MARGIN, Math.min(1 + ANNOTATION_MARGIN, (position - start) / Math.max(1, length) * ANNOTATION_BOARD_SCALE - ANNOTATION_MARGIN));
  return { x:fromBoard(event.clientX,rect.left,rect.width), y:fromBoard(event.clientY,rect.top,rect.height) };
}
function moveAnnotation(item, dx, dy) {
  const xs = item.type === "arrow" ? [item.x, item.x2] : [item.x];
  const ys = item.type === "arrow" ? [item.y, item.y2] : [item.y];
  dx = Math.max(-ANNOTATION_MARGIN - Math.min(...xs), Math.min(1 + ANNOTATION_MARGIN - Math.max(...xs), dx));
  dy = Math.max(-ANNOTATION_MARGIN - Math.min(...ys), Math.min(1 + ANNOTATION_MARGIN - Math.max(...ys), dy));
  return { ...item, x: item.x + dx, y: item.y + dy, ...(item.type === "arrow" ? { x2:item.x2 + dx, y2:item.y2 + dy } : {}) };
}
function newAnnotationId() { return "ann_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,10); }
function annotationColor() { return /^#[0-9a-fA-F]{6}$/.test($("annotationColor").value) ? $("annotationColor").value : "#ffcc00"; }
function annotationPointerDown(event) {
  if (!canEditAnnotations() || event.button !== 0 || (annotationGesture && annotationGesture.pointerId !== event.pointerId)) return;
  const point = annotationPoint(event);
  const before = annotationCopy(imageAnnotations);
  const target = event.target.closest?.("[data-annotation-id]");
  if (annotationTool === "select" && target) {
    selectedAnnotationId = target.getAttribute("data-annotation-id");
    const item = selectedAnnotation();
    if (!item) return;
    annotationGesture = { pointerId:event.pointerId, before, origin:point, item:annotationCopy(item), handle:event.target.getAttribute?.("data-handle") || "move" };
  } else if (annotationTool === "text") {
    if (imageAnnotations.length >= ANNOTATION_LIMIT) { setMsg("annotationsMsg", "Maximum 80 annotations par image."); return; }
    annotationCheckpoint();
    const item = { id:newAnnotationId(), type:"text", ...point, color:annotationColor(), text:$("annotationText").value || "Consigne", size:Number($("annotationSize").value) || 28 };
    imageAnnotations.push(item); selectedAnnotationId = item.id; annotationTool = "select";
    event.preventDefault(); renderAnnotations(); $("annotationText").focus?.(); return;
  } else if (annotationTool === "arrow") {
    if (imageAnnotations.length >= ANNOTATION_LIMIT) { setMsg("annotationsMsg", "Maximum 80 annotations par image."); return; }
    const item = { id:newAnnotationId(), type:"arrow", ...point, x2:point.x, y2:point.y, color:annotationColor() };
    imageAnnotations.push(item); selectedAnnotationId = item.id;
    annotationGesture = { pointerId:event.pointerId, before, origin:point, item, handle:"end", creating:true };
  } else { selectedAnnotationId = ""; renderAnnotations(); return; }
  event.preventDefault();
  $("annotationOverlay").setPointerCapture?.(event.pointerId);
  renderAnnotations();
}
function annotationPointerMove(event) {
  if (!canEditAnnotations() || !annotationGesture || event.pointerId !== annotationGesture.pointerId) return;
  const point = annotationPoint(event), drag = annotationGesture;
  const index = imageAnnotations.findIndex(item => item.id === drag.item.id);
  if (index < 0) return;
  if (drag.handle === "start") imageAnnotations[index] = { ...drag.item, x:point.x, y:point.y };
  else if (drag.handle === "end") imageAnnotations[index] = { ...drag.item, x2:point.x, y2:point.y };
  else imageAnnotations[index] = moveAnnotation(drag.item, point.x - drag.origin.x, point.y - drag.origin.y);
  event.preventDefault(); renderAnnotations();
}
function annotationPointerEnd(event, cancelled = false) {
  if (!annotationGesture || event.pointerId !== annotationGesture.pointerId) return;
  const drag = annotationGesture;
  if (!cancelled) annotationPointerMove(event);
  const item = selectedAnnotation();
  if (cancelled || (drag.creating && item && Math.hypot(item.x2-item.x, item.y2-item.y) < .01)) {
    imageAnnotations = drag.before; selectedAnnotationId = "";
  } else if (JSON.stringify(drag.before) !== JSON.stringify(imageAnnotations)) annotationCheckpoint(drag.before);
  annotationGesture = null;
  const svg = $("annotationOverlay");
  if (svg.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  if (drag.creating) annotationTool = "select";
  renderAnnotations();
}
function editSelectedAnnotation() {
  if (!canEditAnnotations() || annotationGesture) return;
  const item = selectedAnnotation();
  if (!item) return;
  const next = { ...item, color:annotationColor() };
  if (item.type === "text") { next.text = $("annotationText").value.slice(0,1000); next.size = Number($("annotationSize").value) || 28; }
  if (JSON.stringify(next) === JSON.stringify(item)) return;
  annotationCheckpoint(); imageAnnotations[imageAnnotations.indexOf(item)] = next; renderAnnotations();
}
function deleteSelectedAnnotation() {
  if (!canEditAnnotations() || annotationGesture || !selectedAnnotation()) return;
  annotationCheckpoint(); imageAnnotations = imageAnnotations.filter(item => item.id !== selectedAnnotationId); selectedAnnotationId = ""; renderAnnotations();
}
function annotationHistory(direction) {
  if (!canEditAnnotations() || annotationGesture) return;
  const from = direction === "undo" ? annotationUndo : annotationRedo;
  const to = direction === "undo" ? annotationRedo : annotationUndo;
  if (!from.length) return;
  to.push(JSON.stringify(imageAnnotations)); imageAnnotations = JSON.parse(from.pop()); selectedAnnotationId = ""; renderAnnotations();
}
function annotationViewHeight() {
  const image = $("imageModalImg");
  return 1000 * (image?.naturalHeight || 700) / (image?.naturalWidth || 1000);
}
function renderAnnotations() {
  const overlay = $("annotationOverlay"); if (!overlay) return;
  const height = annotationViewHeight();
  overlay.setAttribute("viewBox", `${-1000 * ANNOTATION_MARGIN} ${-height * ANNOTATION_MARGIN} ${1000 * ANNOTATION_BOARD_SCALE} ${height * ANNOTATION_BOARD_SCALE}`);
  overlay.innerHTML = imageAnnotations.map(item => {
    const selected = item.id === selectedAnnotationId && canEditAnnotations();
    const x=item.x*1000, y=item.y*height;
    let shape;
    if (item.type === "text") {
      const lines = item.text.split("\n");
      shape = `<text x="${x}" y="${y}" fill="${item.color}" font-size="${item.size}" font-family="Arial, sans-serif" font-weight="700" dominant-baseline="hanging" stroke="#101827" stroke-width="${selected ? 2 : 1.2}" paint-order="stroke" style="white-space:pre">${lines.map((line,index) => `<tspan x="${x}" dy="${index ? '1.2em' : 0}">${escapeHtml(line || " ")}</tspan>`).join("")}</text>`;
      if (selected) shape += `<circle cx="${x}" cy="${y}" r="6" fill="#ffffff" stroke="${item.color}" stroke-width="2"/>`;
    } else {
      const x2=item.x2*1000, y2=item.y2*height, angle=Math.atan2(y2-y,x2-x), size=15;
      const a=[x2-size*Math.cos(angle-.5),y2-size*Math.sin(angle-.5)], b=[x2-size*Math.cos(angle+.5),y2-size*Math.sin(angle+.5)];
      shape = `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="transparent" stroke-width="24" pointer-events="stroke"/><line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${item.color}" stroke-width="4" stroke-linecap="round"/><polygon points="${x2},${y2} ${a.join(',')} ${b.join(',')}" fill="${item.color}"/>`;
      if (selected) shape += `<circle data-handle="start" cx="${x}" cy="${y}" r="9" fill="#fff" stroke="${item.color}" stroke-width="3"/><circle data-handle="end" cx="${x2}" cy="${y2}" r="9" fill="#fff" stroke="${item.color}" stroke-width="3"/>`;
    }
    return `<g data-annotation-id="${item.id}" class="${selected ? 'annotation-selected' : ''}"><title>${escapeHtml(item.type === "text" ? item.text : "Flèche")}</title>${shape}</g>`;
  }).join("");
  updateAnnotationControls();
}
function updateAnnotationControls() {
  const editor = $("annotationTools"); if (!editor) return;
  const admin = currentProfile?.role === "admin", editable = canEditAnnotations();
  editor.classList.toggle("hidden", !admin);
  const item = selectedAnnotation();
  for (const [id,tool] of [["annotationSelectTool","select"],["annotationTextTool","text"],["annotationArrowTool","arrow"]]) {
    $(id).classList.toggle("annotation-tool-active", annotationTool === tool); $(id).setAttribute("aria-pressed",String(annotationTool === tool));
  }
  for (const el of editor.querySelectorAll("button,input,textarea,select")) el.disabled = !editable;
  $("annotationDeleteBtn").disabled = !editable || !item;
  $("annotationUndoBtn").disabled = !editable || !annotationUndo.length;
  $("annotationRedoBtn").disabled = !editable || !annotationRedo.length;
  $("annotationText").disabled = !editable || (item?.type === "arrow");
  $("annotationSize").disabled = !editable || (item?.type === "arrow");
  if (item) {
    $("annotationColor").value = item.color;
    if (item.type === "text") {
      if ($("annotationText").value !== item.text) $("annotationText").value = item.text;
      $("annotationSize").value = String(item.size);
    }
  }
  $("annotationOverlay").classList.toggle("can-annotate", editable);
  $("annotationOverlay").classList.toggle("drawing-tool", editable && annotationTool !== "select");
  $("annotationHelp").textContent = annotationTool === "text" ? "Clique sur l’image ou dans la marge autour pour placer ton texte, puis déplace-le en mode Sélection." : annotationTool === "arrow" ? "Clique puis fais glisser pour tracer une flèche, sur l’image ou dans les marges." : "Sélectionne puis déplace un texte ou une flèche. Les deux poignées d’une flèche déplacent ses extrémités.";
  $("annotationSaveBtn").disabled = !editable || !annotationsDirty() || Boolean(annotationGesture);
  const message = $("annotationsMsg").textContent;
  if (annotationsDirty() && (!message || message.startsWith("Annotations enregistrées"))) setMsg("annotationsMsg", "Modifications non enregistrées.");
  else if (!annotationsDirty() && message === "Modifications non enregistrées.") setMsg("annotationsMsg", "");
}
function fitStratCanvas() {
  const stage = $("stratImageStage"), image = $("imageModalImg"), canvas = $("stratCanvas"), viewport = $("stratCanvasViewport");
  if (!stage || !canvas || !viewport || !image) return;
  const ratio = (image.naturalWidth || 1000) / (image.naturalHeight || 700);
  const width = Math.max(100,Math.min(image.naturalWidth || 1000, ((stage.clientWidth || 1000)-32)/ANNOTATION_BOARD_SCALE, (((stage.clientHeight || 700)-32)/ANNOTATION_BOARD_SCALE)*ratio));
  canvas.style.width=(width*ANNOTATION_BOARD_SCALE)+"px"; canvas.style.height=(width/ratio*ANNOTATION_BOARD_SCALE)+"px";
  canvas.style.transform=`scale(${imageZoom})`;
  viewport.style.width=(width*ANNOTATION_BOARD_SCALE*imageZoom)+"px"; viewport.style.height=(width/ratio*ANNOTATION_BOARD_SCALE*imageZoom)+"px";
  renderAnnotations();
}
function loadImageAnnotations(item) {
  const raw = String(item.annotationData || "");
  openStratImage.annotationData = raw; openStratImage.annotationsError = "";
  try { imageAnnotations = decodeAnnotations(raw); }
  catch (err) { imageAnnotations = []; openStratImage.annotationsError = err.message; }
  openStratImage.annotationsBaseline = JSON.stringify(imageAnnotations);
  annotationGesture = null; selectedAnnotationId = ""; annotationUndo=[]; annotationRedo=[]; annotationTool="select";
  setMsg("annotationsMsg", openStratImage.annotationsError ? "Les annotations enregistrées sont invalides. Elles sont conservées, mais l’édition est bloquée." : "");
  renderAnnotations();
}
function syncImageAnnotations(item) {
  if (!openStratImage) return;
  const raw = String(item.annotationData || "");
  if (raw === openStratImage.annotationData) { updateAnnotationControls(); return; }
  if (!annotationsDirty()) loadImageAnnotations(item);
  else setMsg("annotationsMsg", "Les annotations ont changé ailleurs. Ton brouillon est conservé ; copie tes consignes si nécessaire, puis recharge les annotations.");
}
async function saveImageAnnotations() {
  if (!canEditAnnotations() || annotationGesture) return;
  const context = { ...openStratImage }, submitted = JSON.stringify(imageAnnotations);
  try {
    decodeAnnotations(submitted);
    if (new TextEncoder().encode(submitted).length > ANNOTATION_BYTES) throw new Error("Annotations trop volumineuses : raccourcis les textes ou supprime des éléments (30 Ko maximum).");
  } catch (err) { setMsg("annotationsMsg", humanError(err)); return; }
  savingAnnotations=true; updateAnnotationControls();
  try {
    const ref = doc(db,"teams",context.teamId,"strats",context.id);
    await runTransaction(db,async transaction => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error("Cette image a été supprimée.");
      if (String(snap.data().annotationData || "") !== context.annotationData) throw new Error("Les annotations ont été modifiées ailleurs. Ton brouillon est conservé ; recharge-les avant de réessayer.");
      transaction.update(ref,{ annotationData:submitted, annotationsUpdatedAt:serverTimestamp(), annotationsUpdatedBy:currentUser.uid });
    });
    if (openStratImage?.id === context.id && openStratImage.teamId === context.teamId) {
      openStratImage.annotationData=submitted; openStratImage.annotationsBaseline=submitted;
      setMsg("annotationsMsg","Annotations enregistrées et partagées avec l’équipe.");
    }
    await logActivity("strat","Annotations de stratégie mises à jour");
  } catch (err) { if (openStratImage?.id===context.id) setMsg("annotationsMsg",humanError(err)); }
  finally { savingAnnotations=false; updateAnnotationControls(); }
}
function initAnnotationEditor() {
  if ($("annotationOverlay").dataset.bound) return;
  $("annotationOverlay").dataset.bound="true";
  for (const [id,tool] of [["annotationSelectTool","select"],["annotationTextTool","text"],["annotationArrowTool","arrow"]]) $(id).addEventListener("click",()=>setAnnotationTool(tool));
  for (const id of ["annotationText","annotationColor","annotationSize"]) $(id).addEventListener("input",editSelectedAnnotation);
  $("annotationDeleteBtn").addEventListener("click",deleteSelectedAnnotation);
  $("annotationUndoBtn").addEventListener("click",()=>annotationHistory("undo"));
  $("annotationRedoBtn").addEventListener("click",()=>annotationHistory("redo"));
  $("annotationSaveBtn").addEventListener("click",saveImageAnnotations);
  $("annotationReloadBtn").addEventListener("click",()=>{
    if (!openStratImage || savingAnnotations) return;
    if (annotationsDirty() && !confirm("Abandonner les annotations non enregistrées et recharger la version publiée ?")) return;
    const item=stratById(openStratImage.id); if(item)loadImageAnnotations(item);
  });
  const svg=$("annotationOverlay");
  svg.addEventListener("pointerdown",annotationPointerDown);
  svg.addEventListener("pointermove",annotationPointerMove);
  svg.addEventListener("pointerup",event=>annotationPointerEnd(event));
  svg.addEventListener("pointercancel",event=>annotationPointerEnd(event,true));
  svg.addEventListener("lostpointercapture",event=>{if(annotationGesture)annotationPointerEnd(event,true);});
  svg.addEventListener("keydown",event=>{
    if (!canEditAnnotations()) return;
    if (["Delete","Backspace"].includes(event.key)) {event.preventDefault();deleteSelectedAnnotation();}
    if (event.key==="Escape") { if(annotationGesture)annotationPointerEnd({pointerId:annotationGesture.pointerId},true);selectedAnnotationId="";annotationTool="select";renderAnnotations(); }
  });
  $("imageModalImg").addEventListener("load",fitStratCanvas);
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(()=>{if(openStratImage)fitStratCanvas();}).observe($("stratImageStage"));
}

function stratNotesDirty() {
  return Boolean(openStratImage && $("stratNotesInput")?.value !== openStratImage.notes);
}

function syncOpenStratNotes() {
  if (!openStratImage) return;
  const item = stratById(openStratImage.id);
  if (!item) { closeImageModal(true); return; }
  const notes = String(item.notes || "");
  if (!stratNotesDirty()) {
    $("stratNotesInput").value = notes;
    openStratImage.notes = notes;
  } else if (notes !== openStratImage.notes) {
    setMsg("stratNotesMsg", "Le texte a changé ailleurs. Ton brouillon est conservé. Ferme puis rouvre l’image pour récupérer la version publiée.");
  }
  $("stratNotesInput").readOnly = currentProfile?.role !== "admin";
  $("saveStratNotesBtn").classList.toggle("hidden", currentProfile?.role !== "admin");
  syncImageAnnotations(item);
}

window.openStratImage = (id) => {
  if (savingStratNotes || savingAnnotations) return;
  const item = stratById(id);
  if (!item?.imageData) return;
  if (stratEditorDirty() && !confirm("Abandonner le texte et les annotations non enregistrés pour ouvrir cette image ?")) return;
  openStratImage = { id, teamId: currentProfile.teamId, notes: String(item.notes || "") };
  initAnnotationEditor();
  loadImageAnnotations(item);
  $("imageModalTitle").textContent = item.name || "Image";
  $("imageModalImg").src = item.imageData;
  $("stratNotesInput").value = openStratImage.notes;
  setMsg("stratNotesMsg", "");
  syncOpenStratNotes();
  setImageZoom(1);
  $("imageModal")?.classList.remove("hidden");
  fitStratCanvas();
};

async function saveStratNotes() {
  if (currentProfile?.role !== "admin" || !openStratImage || savingStratNotes) return;
  const context = { ...openStratImage };
  const notes = $("stratNotesInput").value;
  if (notes.length > 20000) { setMsg("stratNotesMsg", "Le texte est limité à 20 000 caractères."); return; }
  savingStratNotes = true;
  $("saveStratNotesBtn").disabled = true;
  try {
    if (currentProfile.teamId !== context.teamId) throw new Error("L’équipe a changé. Rouvre l’image.");
    const ref = doc(db, "teams", context.teamId, "strats", context.id);
    await runTransaction(db, async transaction => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error("Cette image a été supprimée.");
      if (String(snap.data().notes || "") !== context.notes) throw new Error("Le texte a été modifié ailleurs. Ton brouillon est conservé ; ferme puis rouvre l’image pour récupérer la dernière version.");
      transaction.update(ref, { notes, updatedAt: serverTimestamp(), updatedBy: currentUser.uid });
    });
    if (openStratImage?.id === context.id && openStratImage.teamId === context.teamId) {
      openStratImage.notes = notes;
      setMsg("stratNotesMsg", "Texte enregistré et partagé avec l’équipe.");
    }
    await logActivity("strat", "Texte de stratégie mis à jour");
  } catch (err) { setMsg("stratNotesMsg", humanError(err)); }
  finally { savingStratNotes = false; $("saveStratNotesBtn").disabled = false; }
}

function closeImageModal(force = false) {
  // A click event is not a force flag.
  if (force !== true && (savingStratNotes || savingAnnotations)) return;
  if (force !== true && stratEditorDirty() && !confirm("Fermer et abandonner le texte et les annotations non enregistrés ?")) return;
  $("imageModal")?.classList.add("hidden");
  if ($("imageModalImg")) $("imageModalImg").src = "";
  if ($("stratNotesInput")) $("stratNotesInput").value = "";
  openStratImage = null;
  imageAnnotations=[]; annotationGesture=null; selectedAnnotationId=""; annotationUndo=[]; annotationRedo=[];
  if ($("annotationOverlay")) $("annotationOverlay").innerHTML="";
}

function setImageZoom(value) {
  imageZoom = Math.max(0.4, Math.min(3, value));
  fitStratCanvas();
  if ($("zoomResetBtn")) $("zoomResetBtn").textContent = `${Math.round(imageZoom * 100)}%`;
}

async function addStratFolder() {
  if (currentProfile?.role !== "admin") return;
  const name = prompt("Nom du dossier ? Exemple : Club, Défense, Attaque...");
  if (!name?.trim()) return;
  try {
    await addDoc(teamCollection("strats"), {
      type: "folder",
      name: name.trim(),
      parentId: currentStratFolderId || "",
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid
    });
    await logActivity("strat", `Dossier strat ajouté : ${name.trim()}`);
    setMsg("stratMsg", "Dossier ajouté.");
  } catch (err) {
    setMsg("stratMsg", humanError(err));
  }
}

async function handleStratImageUpload(event) {
  if (currentProfile?.role !== "admin") return;
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    setMsg("stratMsg", "Choisis une image valide.");
    return;
  }
  const defaultName = file.name.replace(/\.[^.]+$/, "");
  const answer = prompt("Nom de l’image ? Exemple : Top, Mid, Sous-sol, RDC", defaultName);
  if (answer === null) return;
  const name = answer || defaultName;
  if (!name.trim()) return;
  setMsg("stratMsg", "Compression et import de l’image...");
  try {
    const imageData = await compressImageToDataUrl(file);
    if (imageData.length > 900000) {
      throw new Error("Image trop lourde après compression. Essaie avec une image plus petite ou une capture recadrée.");
    }
    await addDoc(teamCollection("strats"), {
      type: "image",
      name: name.trim(),
      parentId: currentStratFolderId || "",
      imageData,
      originalFileName: file.name,
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid
    });
    await logActivity("strat", `Image strat ajoutée : ${name.trim()}`);
    setMsg("stratMsg", "Image ajoutée. Les joueurs peuvent la consulter et zoomer.");
  } catch (err) {
    setMsg("stratMsg", humanError(err));
  }
}

function compressImageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Lecture de l’image impossible."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Image impossible à charger."));
      img.onload = () => {
        const maxSide = 1400;
        let { width, height } = img;
        const scale = Math.min(1, maxSide / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        let quality = 0.82;
        let data = canvas.toDataURL("image/jpeg", quality);
        while (data.length > 900000 && quality > 0.45) {
          quality -= 0.08;
          data = canvas.toDataURL("image/jpeg", quality);
        }
        resolve(data);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

window.deleteStratItem = async (id) => {
  if (currentProfile?.role !== "admin" || !id) return;
  const item = stratById(id);
  if (!item) return;
  const hasChildren = strats.some((s) => (s.parentId || "") === id);
  const msg = hasChildren
    ? `Supprimer "${item.name}" et tout ce qu’il contient ?`
    : `Supprimer "${item.name}" ?`;
  if (!confirm(msg)) return;
  try {
    const ids = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const s of strats) {
        if (!ids.has(s.id) && ids.has(s.parentId || "")) {
          ids.add(s.id);
          changed = true;
        }
      }
    }
    const batch = writeBatch(db);
    ids.forEach((sid) => batch.delete(teamDoc("strats", sid)));
    await batch.commit();
    if (ids.has(currentStratFolderId)) currentStratFolderId = "";
    await logActivity("strat", `Strat supprimée : ${item.name || "élément"}`);
    setMsg("stratMsg", "Élément supprimé.");
  } catch (err) {
    setMsg("stratMsg", humanError(err));
  }
};

function nameByUid(uid) {
  if (!uid) return "";
  return players.find((p) => p.uid === uid)?.name || registeredUsers.find((p) => p.uid === uid)?.name || "";
}

async function logActivity(type, message, extra = {}) {
  if (!db || !currentUser) return;
  try {
    await addDoc(teamCollection("activityLog"), {
      type,
      message,
      userId: currentUser.uid,
      userName: currentProfile?.name || currentUser.displayName || "Compte",
      createdAt: serverTimestamp(),
      ...extra
    });
  } catch (err) {
    console.warn("Historique non enregistré", err);
  }
}

function renderActivityLog() {
  const wrap = $("activityLogWrap");
  if (!wrap) return;
  if (currentProfile?.role !== "admin") {
    wrap.innerHTML = `<p class="muted">Historique réservé aux admins.</p>`;
    return;
  }
  if (!activityLog.length) {
    wrap.innerHTML = `<p class="muted">Aucun changement enregistré pour le moment.</p>`;
    return;
  }
  wrap.innerHTML = activityLog.map((a) => {
    const date = formatLogDate(a.createdAt);
    return `<div class="activity-item activity-${escapeAttr(a.type || "info")}">
      <div><strong>${escapeHtml(a.message || "Changement")}</strong><br><span>${escapeHtml(a.userName || "Compte")}</span></div>
      <time>${escapeHtml(date)}</time>
    </div>`;
  }).join("");
}

function formatLogDate(value) {
  const d = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  if (!d || !Number.isFinite(d.getTime())) return "À l’instant";
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function initTheme() {
  const saved = localStorage.getItem("r6-theme") || "dark";
  document.body.classList.toggle("light-theme", saved === "light");
  updateThemeLabel();
}

function toggleTheme() {
  const next = document.body.classList.contains("light-theme") ? "dark" : "light";
  localStorage.setItem("r6-theme", next);
  document.body.classList.toggle("light-theme", next === "light");
  updateThemeLabel();
}

function updateThemeLabel() {
  const btn = $("themeToggleBtn");
  if (!btn) return;
  btn.textContent = document.body.classList.contains("light-theme") ? "Mode sombre" : "Mode clair";
}

function roleLabel(role) { return { admin: "Admin", player: "Joueur", viewer: "Lecture seule", pending: "En attente", rejected: "Refusé" }[role] || "Lecture seule"; }
function guessName(email) { return (email || "joueur").split("@")[0]; }
function safeKey(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9_-]/g, "_"); }
function setMsg(id, text) { $(id).textContent = text || ""; }
function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
function kd(k, d) { return d ? (num(k) / num(d)).toFixed(2) : String(num(k)); }
function hsPercentValue(headshots, kills) {
  const k = num(kills);
  if (!k) return 0;
  return Math.min(100, Math.max(0, (num(headshots) / k) * 100));
}
function hsPercent(headshots, kills) { return `${Math.round(hsPercentValue(headshots, kills))}%`; }
function escapeHtml(str) { return String(str ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function escapeAttr(str) { return escapeHtml(str).replace(/'/g, "&#39;"); }
function humanError(err) {
  console.error(err);
  const code = String(err?.code || "");
  const messages = {
    "auth/invalid-credential": "Email ou mot de passe incorrect, ou compte inexistant dans ce projet Firebase.",
    "auth/wrong-password": "Mot de passe incorrect.",
    "auth/user-not-found": "Compte introuvable dans ce projet Firebase.",
    "auth/invalid-email": "Adresse email invalide.",
    "auth/email-already-in-use": "Cette adresse email possède déjà un compte. Utilise Se connecter.",
    "auth/weak-password": "Mot de passe trop faible (au moins 6 caractères).",
    "auth/operation-not-allowed": "Connexion Email/Mot de passe désactivée dans Firebase Authentication.",
    "auth/unauthorized-domain": "Domaine non autorisé : ajoute le domaine GitHub Pages dans Firebase Authentication > Settings > Authorized domains.",
    "auth/network-request-failed": "Connexion réseau impossible. Vérifie Internet et l'accès à Firebase.",
    "auth/too-many-requests": "Trop de tentatives de connexion. Réessaie plus tard ou réinitialise ton mot de passe.",
    "auth/user-disabled": "Ce compte a été désactivé dans Firebase Authentication."
  };
  if (messages[code]) return messages[code] + ` [${code}]`;
  if (code.includes("permission-denied")) return "Permission refusée : vérifie les règles Firestore. [" + code + "]";
  return (err?.message || "Erreur inconnue.") + (code ? ` [${code}]` : "");
}
