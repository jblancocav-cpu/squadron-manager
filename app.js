// === CONSTANTES ===
const SECTIONS = [
    "Comandante de Esquadrão", "Seção de Comando",
    "Pelotão de Comunicações", "Pelotão de Aprovisionamento",
    "Pelotão de Saúde", "Pelotão de Manutenção",
    "CIMPORÃ", "Pelotão de Comando", "Adidos/Encostados/Reintegrados"
];

const RANK_WEIGHTS = {
    'Cel': 1, 'Ten Cel': 2, 'Maj': 3, 'Cap': 4,
    '1º Ten': 5, '2º Ten': 6, 'Asp': 7,
    'STen': 8, '1º Sgt': 9, '2º Sgt': 10, '3º Sgt': 11,
    'Cb': 12, 'Sd': 13
};
function getRankWeight(rank) { return RANK_WEIGHTS[rank] || 99; }

const STATUS_CFG = {
    disponivel: { label: 'Disponível',   color: '#10b981', bg: 'rgba(16,185,129,.12)' },
    servico:    { label: 'De Serviço',   color: '#3b82f6', bg: 'rgba(59,130,246,.12)' },
    ferias:     { label: 'Férias',       color: '#8b5cf6', bg: 'rgba(139,92,246,.12)' },
    licenca:    { label: 'Lic. Médica',  color: '#f59e0b', bg: 'rgba(245,158,11,.12)' },
    afastado:   { label: 'Afastado',     color: '#ef4444', bg: 'rgba(239,68,68,.12)'  },
    missao:     { label: 'Em Missão',    color: '#3b82f6', bg: 'rgba(59,130,246,.12)' },
    adido:      { label: 'Adido',        color: '#64748b', bg: 'rgba(100,116,139,.12)' },
    encostado:  { label: 'Encostado',    color: '#64748b', bg: 'rgba(100,116,139,.12)' },
    reintegrado:{ label: 'Reintegrado',  color: '#64748b', bg: 'rgba(100,116,139,.12)' }
};

const PRIORITY_CFG = {
    alta:  { label: 'Alta',  color: '#ef4444', bg: 'rgba(239,68,68,.12)'  },
    media: { label: 'Média', color: '#f59e0b', bg: 'rgba(245,158,11,.12)' },
    baixa: { label: 'Baixa', color: '#10b981', bg: 'rgba(16,185,129,.12)' }
};

const OCC_CFG = {
    'Elogio':      { color: '#10b981' },
    'Advertência': { color: '#f59e0b' },
    'Punição':     { color: '#ef4444' },
    'Acidente':    { color: '#f97316' },
    'Observação':  { color: '#3b82f6' },
    'Outro':       { color: '#8b5cf6' }
};

// === FIREBASE INIT E ESTADO ===
const firebaseConfig = {
  apiKey: "AIzaSyDupHPqwk2DLkFLvYxiWWE55BfuwacDULk",
  authDomain: "squadron-manager-efb47.firebaseapp.com",
  databaseURL: "https://squadron-manager-efb47-default-rtdb.firebaseio.com",
  projectId: "squadron-manager-efb47",
  storageBucket: "squadron-manager-efb47.firebasestorage.app",
  messagingSenderId: "830515353810",
  appId: "1:830515353810:web:ffb9ebf70e9dd69dc2750b",
  measurementId: "G-7G4WQ55CBF"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();
const dbRef = db.ref('squadron_data');
const ADMIN_EMAIL = "jblancocav@gmail.com";

let currentUser = null;
let userRole = 'reader'; // mantido para compatibilidade
let userPermissions = {};

function hasPermission(action) {
    if (userPermissions.isAdmin) return true;
    return !!userPermissions[action];
}

function checkAuthorRule(item) {
    if (hasPermission('isAdmin')) return true;
    // Se não for admin, e o item foi criado por um admin, bloqueia.
    if (item && item.createdByRole === 'admin') return false;
    return true;
}

// Converte papéis antigos para o novo modelo, caso o usuário não tenha o objeto "permissions" salvo
function getLegacyPermissions(role) {
    if (role === 'admin') return { isAdmin: true };
    if (role === 'operator') return {
        managePersonnel: true,
        deletePersonnel: true,
        manageRoster: true,
        viewTasks: true,
        manageTasks: true,
        viewRestricted: false,
        addOccurrences: true
    };
    if (role === 'reader') return {
        viewTasks: true
    };
    return {};
}

let state = {
    personnel:   [],
    tasks:       [],
    occurrences: [],
    statusHistory: [],
    notices: [],
    calendarEvents: [],
    missions: [],
    serviceRosters: [],
    users: {}
};

let currentProfileId = null;
let pendingPhoto = null;
let charts = { section: null, status: null };
let expandedSections = new Set(); 

let _isSaving = false;
let _isInitialLoad = true;

// === AUTH LOGIC ===
auth.onAuthStateChanged(user => {
    const overlay = document.getElementById('loginOverlay');
    if (user) {
        currentUser = user;
        // Buscar papel do usuário
        db.ref('users/' + user.uid).on('value', snap => {
            const userData = snap.val();
            const emailNormal = (user.email || "").toLowerCase();
            
            if (emailNormal === ADMIN_EMAIL.toLowerCase()) {
                userRole = 'admin';
            } else {
                userRole = userData ? userData.role : 'reader';
            }
            
            // Se for o e-mail do Admin, SEMPRE garante papel admin no DB
            if (emailNormal === ADMIN_EMAIL.toLowerCase()) {
                if (!userData || userData.role !== 'admin' || !userData.permissions?.isAdmin) {
                    db.ref('users/' + user.uid).update({
                        name: user.displayName || userData?.name || 'Cacique Admin',
                        email: user.email,
                        role: 'admin',
                        permissions: { isAdmin: true }
                    });
                }
            }

            // Carregar permissões (ou usar legado)
            if (userData && userData.permissions) {
                userPermissions = userData.permissions;
            } else {
                userPermissions = getLegacyPermissions(userRole);
            }

            overlay.style.display = 'none';
            const loadingOverlay = document.getElementById('loadingOverlay');
            if (loadingOverlay) loadingOverlay.style.display = 'none';
            
            // Mostrar itens de admin se for admin
            document.querySelectorAll('.admin-only').forEach(el => {
                el.style.display = hasPermission('isAdmin') ? 'flex' : 'none';
            });

            document.querySelectorAll('.tasks-only').forEach(el => {
                const isNav = el.classList.contains('nav-item');
                el.style.display = hasPermission('viewTasks') ? (isNav ? 'flex' : 'block') : 'none';
            });

            if (_isInitialLoad) {
                if (userRole === 'admin') {
                    alert("Cacique detectado! Acesso Total liberado.");
                } else {
                    alert("Identidade: " + userRole + "\nE-mail detectado: [" + emailNormal + "]");
                }
            }

            initAppSync();
        });
    } else {
        currentUser = null;
        userRole = 'reader';
        overlay.style.display = 'flex';
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (loadingOverlay) loadingOverlay.style.display = 'none';
        // Limpar listeners se necessário
        dbRef.off();
    }
});

let dbListenerActive = false;

function initAppSync() {
    if (dbListenerActive) {
        console.log("Listener do Firebase já está ativo. Pulando nova inicialização.");
        return;
    }
    
    console.log("Iniciando sincronização com Firebase...");
    dbListenerActive = true;

    dbRef.on('value', (snapshot) => {
        const data = snapshot.val();
        
        if (data) {
            console.log("Dados recebidos do Firebase.");
            state.personnel = data.personnel || [];
            state.tasks = data.tasks || [];
            state.occurrences = data.occurrences || [];
            state.statusHistory = data.statusHistory || [];
            state.notices = data.notices || [];
            state.calendarEvents = data.calendarEvents || [];
            state.missions = data.missions || [];
            state.serviceRosters = data.serviceRosters || [];

            // Atualiza a tela se os dados vieram da nuvem (e não de um save local nosso)
            if (!_isSaving) {
                const activeView = document.querySelector('.view.active') || { id: 'dashboardView' };
                const id = activeView.id.replace('View', '');
                console.log("Renderizando view após atualização remota:", id);
                showView(id);
            } else {
                console.log("Ignorando renderização: salvamento local em curso.");
            }
        }
        _isInitialLoad = false;
    });
}

// Load remembered user
const savedEmail = localStorage.getItem('squadron_remembered_email');
if (savedEmail) {
    document.getElementById('loginEmail').value = savedEmail;
    const rememberCheckbox = document.getElementById('loginRemember');
    if (rememberCheckbox) rememberCheckbox.checked = true;
}

// Login
document.getElementById('loginForm').addEventListener('submit', e => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const pass = document.getElementById('loginPassword').value;
    const rememberCheckbox = document.getElementById('loginRemember');
    
    if (rememberCheckbox && rememberCheckbox.checked) {
        localStorage.setItem('squadron_remembered_email', email);
    } else {
        localStorage.removeItem('squadron_remembered_email');
    }

    auth.signInWithEmailAndPassword(email, pass).catch(err => {
        alert("Erro no login: " + err.message);
    });
});

// Registro
document.getElementById('registerForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('regName').value;
    const email = document.getElementById('regEmail').value;
    const pass = document.getElementById('regPassword').value;
    
    auth.createUserWithEmailAndPassword(email, pass).then(cred => {
        return db.ref('users/' + cred.user.uid).set({
            name: name,
            email: email,
            role: 'reader' // Todos começam como leitor
        });
    }).then(() => {
        alert("Solicitação enviada! Aguarde o Admin liberar seu acesso.");
    }).catch(err => {
        alert("Erro no registro: " + err.message);
    });
});

// Alternar telas de login
document.getElementById('btnShowRegister').onclick = () => {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'flex';
};
document.getElementById('btnShowLogin').onclick = () => {
    document.getElementById('loginForm').style.display = 'flex';
    document.getElementById('registerForm').style.display = 'none';
};

// Logout
document.getElementById('btnLogout').onclick = () => {
    if(confirm("Deseja sair do sistema?")) {
        auth.signOut();
    }
};

function saveState() {
    // Se não tiver nenhuma permissão, é um leitor puro, não salva estado global
    if (!hasPermission('isAdmin') && !Object.values(userPermissions).some(v => v)) {
        console.warn("Sem permissão para salvar no Firebase.");
        return;
    }

    // Nuvem
    _isSaving = true;
    dbRef.set({
        personnel: state.personnel,
        tasks: state.tasks,
        occurrences: state.occurrences,
        statusHistory: state.statusHistory,
        notices: state.notices,
        calendarEvents: state.calendarEvents,
        missions: state.missions,
        serviceRosters: state.serviceRosters
    }).then(() => {
        _isSaving = false;
        console.log("Estado salvo com sucesso no Firebase.");
    }).catch(err => {
        console.error("Erro no Firebase:", err);
        _isSaving = false;
        alert("ERRO AO SALVAR NA NUVEM: " + err.message + "\nSuas alterações podem ser perdidas ao atualizar.");
    });
}


// === VIEWS ===
const VIEWS = ['dashboard','escala','personnel','profile','tasks','informativo','users'];

function showView(name) {
    if (name === 'users' && !hasPermission('isAdmin')) {
        showView('dashboard');
        return;
    }
    if (name === 'tasks' && !hasPermission('viewTasks')) {
        showView('dashboard');
        return;
    }
    VIEWS.forEach(v => document.getElementById(v+'View').classList.remove('active'));
    document.getElementById(name+'View').classList.add('active');
    const titles = {
        dashboard: '', escala: 'Destinos',
        personnel: 'Efetivo da SU', profile: 'Ficha Individual', tasks: 'Gestão de Tarefas',
        informativo: 'Avisos e QTS'
    };
    document.getElementById('pageTitle').textContent = titles[name] || '';

    if (name === 'dashboard')   renderDashboard();
    if (name === 'escala')      { renderEscala(); renderMissions(); renderServiceRosters(); }
    if (name === 'personnel')   renderPersonnelList();
    if (name === 'tasks')       { updateAssigneeSelects(); renderTasks(); }
    if (name === 'informativo') renderInformativo();
    if (name === 'users')       renderUsers();
}

// === INIT ===
document.addEventListener('DOMContentLoaded', () => {
    // Zoom automático de 80% conforme pedido do Cacique
    document.body.style.zoom = "80%";

    lucide.createIcons();
    initTheme();

    // Navegação sidebar
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', e => {
            e.preventDefault();
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            e.currentTarget.classList.add('active');
            showView(e.currentTarget.dataset.view);
        });
    });

    document.getElementById('btnBackToPersonnel').addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(n =>
            n.classList.toggle('active', n.dataset.view === 'personnel'));
        showView('personnel');
    });

    setupModals();
    setupPersonnelForm();
    setupTaskForm();
    setupOccurrenceForm();
    setupFilters();
    updateDate();

    // ONE-TIME RESET V2: Fix capitalized statuses from JSON imports
    if (!localStorage.getItem('squadron_missions_wiped_v2')) {
        state.missions = [];
        state.personnel.forEach(p => {
            if (p.status) p.status = p.status.toLowerCase().trim();
            if (p.status === 'disponível') p.status = 'disponivel'; // common typo in imports
            
            const st = p.status || 'disponivel';
            if (!['ferias', 'licenca', 'afastado', 'servico'].includes(st)) {
                p.status = 'disponivel';
                p.statusReason = '';
                p.statusReturnDate = null;
            }
        });
        saveState();
        localStorage.setItem('squadron_missions_wiped_v2', 'true');
    }

    checkExpiredMissions(); // Clean stale data BEFORE rendering

    renderDashboard();
    renderPersonnelList();
    renderTasks();
    renderEscala();
    renderInformativo();
    renderMissions();
    renderServiceRosters();
    // setupQuickSearch();
    setupTabs();
    setupServiceForm();
});

function updateDate() {
    document.getElementById('currentDate').textContent =
        new Date().toLocaleDateString('pt-BR', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}

// === TEMA ===
function initTheme() {
    setTheme(localStorage.getItem('squadron_theme') || 'light');
    document.getElementById('themeToggle').addEventListener('click', () => {
        setTheme(document.body.classList.contains('theme-dark') ? 'light' : 'dark');
    });
}

function setTheme(t) {
    document.body.classList.toggle('theme-dark', t === 'dark');
    document.body.classList.toggle('theme-light', t !== 'dark');
    
    // Procura o ícone dentro do botão (ID pode sumir quando o Lucide substitui o elemento)
    const toggleBtn = document.getElementById('themeToggle');
    if (toggleBtn) {
        const icon = toggleBtn.querySelector('[data-lucide]');
        if (icon) icon.setAttribute('data-lucide', t === 'dark' ? 'sun' : 'moon');
        
        const text = document.getElementById('themeText');
        if (text) text.textContent = t === 'dark' ? 'Modo Claro' : 'Modo Escuro';
    }
    
    localStorage.setItem('squadron_theme', t);
    
    if (window.lucide) lucide.createIcons();
    
    if (document.getElementById('dashboardView')?.classList.contains('active')) {
        updateCharts();
    }
}

// === MODAIS ===
function openModal(id)  { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

function setupModals() {
    document.querySelectorAll('[data-modal]').forEach(btn => {
        if (btn.tagName === 'BUTTON') {
            btn.addEventListener('click', () => closeModal(btn.dataset.modal));
        }
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) closeModal(overlay.id);
        });
    });

    document.getElementById('btnAddPersonnel').addEventListener('click', () => {
        resetPersonnelForm();
        document.getElementById('personnelModalTitle').textContent = 'Adicionar Militar';
        openModal('personnelModal');
    });

    document.getElementById('btnAddTask').addEventListener('click', () => {
        document.getElementById('taskForm').reset();
        document.getElementById('taskId').value = '';
        document.getElementById('taskModalTitle').textContent = 'Nova Tarefa';
        currentTaskSelectedIds = new Set(); // Reset selection
        updateAssigneeSelects();
        openModal('taskModal');
    });

    const fileInput = document.getElementById('importJson');
    const btnImport = document.getElementById('btnImportJson');
    if (btnImport && fileInput) {
        btnImport.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    if (Array.isArray(data)) {
                        // Merge com o personnel existente, ignorando IDs duplicados
                        const existingIds = new Set(state.personnel.map(p => p.id));
                        const newPersonnel = data.filter(p => !existingIds.has(p.id));
                        state.personnel = [...state.personnel, ...newPersonnel];
                        saveState();
                        renderPersonnelList();
                        renderDashboard();
                        renderEscala();
                        updateAssigneeSelects();
                        alert(`${newPersonnel.length} militares importados com sucesso!`);
                    } else if (data && typeof data === 'object' && data.personnel) {
                        // Backup completo do estado
                        if (confirm("Este arquivo parece ser um backup completo. Deseja RESTAURAR todo o sistema? (Isso substituirá os dados atuais)")) {
                            state = { ...state, ...data }; // Merge keys
                            saveState();
                            alert("Sistema restaurado com sucesso! A página será recarregada.");
                            window.location.reload();
                        }
                    } else {
                        alert("O formato do arquivo JSON é inválido.");
                    }
                } catch(err) {
                    alert("Erro ao ler o arquivo JSON.");
                }
                fileInput.value = ''; // Reset input
            };
            reader.readAsText(file);
        });
    }

    document.getElementById('btnExportJson').addEventListener('click', () => {
        const dataStr = JSON.stringify(state, null, 4);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        const exportFileDefaultName = `squadron_backup_${new Date().toISOString().split('T')[0]}.json`;
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
    });

    const btnPersonnelPDF = document.getElementById('btnExportPersonnelPDF');
    if (btnPersonnelPDF) {
        btnPersonnelPDF.addEventListener('click', () => {
            exportViewToPDF('personnelList', 'Diretório_de_Pessoal');
        });
    }

    const btnEscalaPDF = document.getElementById('btnExportEscalaPDF');
    if (btnEscalaPDF) {
        btnEscalaPDF.addEventListener('click', () => {
            exportViewToPDF('escalaView', 'Escala_de_Servico');
        });
    }
}

function exportViewToPDF(elementId, fileName) {
    const element = document.getElementById(elementId);
    const opt = {
        margin:       10,
        filename:     `${fileName}_${new Date().toISOString().split('T')[0]}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    // Temporariamente expandir todas as seções para o PDF se for a lista de pessoal
    const collapsedTables = element.querySelectorAll('.escala-table-wrap');
    const originalStyles = [];
    collapsedTables.forEach(t => {
        originalStyles.push(t.style.display);
        t.style.display = 'block';
    });

    // Adicionar um cabeçalho para o PDF
    const header = document.createElement('div');
    header.innerHTML = `
        <div style="text-align:center;margin-bottom:20px;padding-bottom:10px;border-bottom:2px solid #3b5a40">
            <h1 style="color:#3b5a40;font-size:22px;margin-bottom:5px">Esqd C Ap - 2026</h1>
            <h2 style="color:#4a5c4e;font-size:16px">${fileName.replace(/_/g, ' ')}</h2>
            <p style="font-size:12px;color:#666">Gerado em: ${new Date().toLocaleString('pt-BR')}</p>
        </div>
    `;
    element.prepend(header);

    html2pdf().set(opt).from(element).save().then(() => {
        // Restaurar estado original
        header.remove();
        collapsedTables.forEach((t, i) => {
            t.style.display = originalStyles[i];
        });
    });
}


// === FILTROS ===
function setupFilters() {
    document.getElementById('searchPersonnel').addEventListener('input', renderPersonnelList);
    document.getElementById('filterSection').addEventListener('change', renderPersonnelList);
    document.getElementById('filterTaskPriority').addEventListener('change', renderTasks);
    document.getElementById('filterTaskAssignee').addEventListener('change', renderTasks);
    document.getElementById('searchEscala').addEventListener('input', renderEscala);
}

// ============================================================
// PART 2: DASHBOARD, ESCALA, PESSOAL, PERFIL
// ============================================================

// === DASHBOARD ===
function calcReturnDate(days) {
    if (!days || days < 1) return null;
    const d = new Date();
    d.setDate(d.getDate() + parseInt(days));
    return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

function calcReturnDateFrom(startDateStr, days) {
    if (!days || days < 1) return null;
    const d = startDateStr ? new Date(startDateStr + 'T12:00:00') : new Date();
    d.setDate(d.getDate() + parseInt(days));
    return d.toISOString().split('T')[0];
}

function updateCharts() {
    const isDark = document.body.classList.contains('theme-dark');
    const textColor = isDark ? '#f2f5ed' : '#1b261e';
    const gridColor = isDark ? 'rgba(242, 245, 237, 0.1)' : 'rgba(27, 38, 30, 0.1)';

    // Filtrar apenas o efetivo real (não excedentes) para os gráficos
    const realPersonnel = state.personnel.filter(m => m.section !== "Adidos/Encostados/Reintegrados");

    // 1. Section Chart (Doughnut)
    const sectionData = SECTIONS
        .filter(sec => sec !== "Adidos/Encostados/Reintegrados")
        .map(sec => ({
            label: sec,
            count: realPersonnel.filter(m => m.section === sec).length
        })).filter(d => d.count > 0);

    const sectionCtx = document.getElementById('sectionChart');
    if (sectionCtx) {
        const sectionColors = [
            '#0ea5e9', '#38bdf8', '#0369a1', '#075985', '#0f172a', 
            '#1e293b', '#334155', '#475569', '#64748b', '#94a3b8'
        ];

        if (charts.section) charts.section.destroy();
        charts.section = new Chart(sectionCtx, {
            type: 'doughnut',
            data: {
                labels: sectionData.map(d => d.label),
                datasets: [{
                    data: sectionData.map(d => d.count),
                    backgroundColor: sectionColors.slice(0, sectionData.length),
                    borderWidth: 0,
                    hoverOffset: 15
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '75%',
                plugins: {
                    legend: { 
                        position: 'bottom', 
                        labels: { 
                            color: textColor, 
                            font: { size: 11, family: 'Outfit', weight: '500' }, 
                            padding: 20,
                            usePointStyle: true,
                            pointStyle: 'circle'
                        } 
                    },
                    tooltip: {
                        backgroundColor: isDark ? 'rgba(15, 23, 19, 0.9)' : 'rgba(255, 255, 255, 0.9)',
                        titleColor: textColor,
                        bodyColor: textColor,
                        borderColor: isDark ? 'rgba(45, 68, 55, 0.5)' : 'rgba(203, 213, 225, 1)',
                        borderWidth: 1,
                        padding: 12,
                        cornerRadius: 8,
                        displayColors: true,
                        callbacks: {
                            label: function(context) {
                                const label = context.label || '';
                                const value = context.raw || 0;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) + '%' : '0%';
                                return ` ${label}: ${value} (${percentage})`;
                            }
                        }
                    }
                }
            }
        });
    }

    // 2. Status Chart (Bar)
    const statusLabels = Object.keys(STATUS_CFG).filter(st => !['adido', 'encostado', 'reintegrado', 'adido', 'encostado', 'reintegrado'].includes(st));
    const statusCounts = statusLabels.map(st => realPersonnel.filter(m => (m.status || 'disponivel') === st).length);

    const statusCtx = document.getElementById('statusChart');
    if (statusCtx) {
        if (charts.status) charts.status.destroy();
        charts.status = new Chart(statusCtx, {
            type: 'bar',
            data: {
                labels: statusLabels.map(st => STATUS_CFG[st].label),
                datasets: [{
                    label: 'Militares',
                    data: statusCounts,
                    backgroundColor: statusLabels.map(st => STATUS_CFG[st].color),
                    borderRadius: 12,
                    barThickness: 24,
                    maxBarThickness: 32
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { 
                            color: textColor, 
                            font: { size: 11, family: 'Outfit' }, 
                            stepSize: 1,
                            padding: 10
                        },
                        grid: { 
                            color: gridColor,
                            drawBorder: false
                        }
                    },
                    x: {
                        ticks: { 
                            color: textColor, 
                            font: { size: 11, family: 'Outfit' },
                            padding: 10
                        },
                        grid: { display: false }
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }

    // 3. Occurrence Chart (Pie)
    const occPeriod = document.getElementById('occPeriodFilter')?.value || '30';
    const nowTime = new Date();
    
    const filteredOccs = state.occurrences.filter(o => {
        if (occPeriod === 'all') return true;
        const occDate = new Date(o.date + 'T12:00:00');
        const diffDays = (nowTime - occDate) / (1000 * 60 * 60 * 24);
        return diffDays <= parseInt(occPeriod);
    });

    const occTypes = ['Elogio', 'Advertência', 'Punição', 'Acidente', 'Observação'];
    const occCounts = occTypes.map(type => filteredOccs.filter(o => o.type === type).length);
    const hasOcc = occCounts.some(c => c > 0);

    const occCtx = document.getElementById('occChart');
    if (occCtx) {
        if (charts.occ) charts.occ.destroy();
        
        if (!hasOcc) {
            // Se não houver dados, mostrar mensagem
            const ctx = occCtx.getContext('2d');
            ctx.clearRect(0, 0, occCtx.width, occCtx.height);
            ctx.fillStyle = textColor;
            ctx.textAlign = 'center';
            ctx.font = '12px Outfit';
            ctx.fillText('Nenhuma ocorrência registrada', occCtx.width/2, occCtx.height/2);
            return;
        }

        charts.occ = new Chart(occCtx, {
            type: 'pie',
            data: {
                labels: occTypes,
                datasets: [{
                    data: occCounts,
                    backgroundColor: ['#10b981', '#f59e0b', '#ef4444', '#6366f1', '#64748b'],
                    borderWidth: 2,
                    borderColor: isDark ? '#1a241c' : '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onClick: (evt, elements) => {
                    if (elements.length > 0) {
                        const index = elements[0].index;
                        const type = occTypes[index];
                        showOccurrenceDetailsModal(type, filteredOccs);
                    }
                },
                onHover: (event, chartElement) => {
                    event.native.target.style.cursor = chartElement[0] ? 'pointer' : 'default';
                },
                plugins: {
                    legend: {
                        position: 'right',
                        labels: { color: textColor, font: { size: 10 }, boxWidth: 10 }
                    }
                }
            }
        });
    }
}

function formatDateBR(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR');
}
function daysUntil(dateStr) {
    if (!dateStr) return null;
    const diff = new Date(dateStr + 'T23:59:59') - new Date();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function renderDashboard() {
    const realPersonnel = state.personnel.filter(m => m.section !== "Adidos/Encostados/Reintegrados");
    const adidosPersonnel = state.personnel.filter(m => m.section === "Adidos/Encostados/Reintegrados");
    
    const elTotal = document.getElementById('totalPersonnel');
    if(elTotal) elTotal.textContent = realPersonnel.length;
    
    const elAdidos = document.getElementById('adidosCount');
    if(elAdidos) elAdidos.textContent = adidosPersonnel.length;
    
    const elDuty = document.getElementById('onDutyCount');
    if(elDuty) elDuty.textContent = realPersonnel.filter(m => m.status === 'servico').length;
    
    const now = new Date(); now.setHours(0,0,0,0);
    const pending = state.tasks.filter(t => t.status !== 'done');
    
    const elPend = document.getElementById('pendingTasksCount');
    if(elPend) elPend.textContent = pending.length;
    
    const elOverdue = document.getElementById('overdueTasksCount');
    if(elOverdue) elOverdue.textContent = pending.filter(t => t.deadline && new Date(t.deadline+'T23:59:59') < new Date()).length;

    // Birthday calculation
    const today = new Date();
    const currentMonth = today.getMonth();
    const birthdayPersonnel = state.personnel.filter(m => {
        if (!m.birthDate) return false;
        const bDate = new Date(m.birthDate + 'T12:00:00');
        return bDate.getMonth() === currentMonth;
    });
    const elBday = document.getElementById('birthdayCount');
    if(elBday) elBday.textContent = birthdayPersonnel.length;

    const grid = document.getElementById('sectionsGrid');
    grid.innerHTML = '';
    SECTIONS.forEach(sec => {
        const personnelInSection = state.personnel.filter(m => m.section === sec);
        const count = personnelInSection.length;
        
        const ofList = ['Cel', 'Ten Cel', 'Maj', 'Cap', '1º Ten', '2º Ten', 'Asp'];
        const sgtList = ['STen', '1º Sgt', '2º Sgt', '3º Sgt'];
        
        const ofCount = personnelInSection.filter(m => ofList.includes(m.rank)).length;
        const sgtCount = personnelInSection.filter(m => sgtList.includes(m.rank)).length;
        const cbCount = personnelInSection.filter(m => m.rank === 'Cb').length;
        const sdCount = personnelInSection.filter(m => m.rank === 'Sd').length;

        const isExcedente = sec === "Adidos/Encostados/Reintegrados";
        const badge = isExcedente ? '<span style="font-size:10px; color:#64748b; background:#f1f5f9; padding:2px 6px; border-radius:10px; margin-left:5px">EXCEDENTE</span>' : '';

        const d = document.createElement('div');
        d.className = 'section-card';
        d.innerHTML = `
            <h3>${sec}${badge}</h3>
            <div class="section-count">${count} <span>militares</span></div>
            <div class="section-breakdown">
                <div title="Oficiais"><span>OF:</span> ${ofCount}</div>
                <div title="ST/Sgt"><span>ST/SGT:</span> ${sgtCount}</div>
                <div title="Cabos"><span>CB:</span> ${cbCount}</div>
                <div title="Soldados"><span>SD:</span> ${sdCount}</div>
            </div>
        `;
        grid.appendChild(d);
    });

    // === Mission List ===
    const missionTitle = document.getElementById('missionDashboardTitle');
    const missionList = document.getElementById('missionDashboardList');
    const inMission = state.personnel
        .filter(m => m.status === 'missao')
        .sort((a, b) => getRankWeight(a.rank) - getRankWeight(b.rank));
    
    if (missionList) {
        if (inMission.length === 0) {
            missionTitle.style.display = 'none';
            missionList.innerHTML = '';
        } else {
            missionTitle.style.display = '';
            let mRows = '';
            inMission.forEach(m => {
                const initials = (m.warName||'?').substring(0,2).toUpperCase();
                const avatarHtml = m.photo ? `<img src="${m.photo}" class="escala-avatar-img">` : `<div class="escala-avatar">${initials}</div>`;
                mRows += `<tr onclick="viewProfile('${m.id}')" style="cursor:pointer" onmouseover="this.style.background='var(--bg-tertiary)'" onmouseout="this.style.background='transparent'">
                    <td><div style="display:flex;align-items:center;gap:10px">${avatarHtml}<strong>${m.rank} ${m.warName}</strong></div></td>
                    <td>${m.section}</td>
                    <td><span class="status-badge" style="color:#3b82f6;background:rgba(59,130,246,.12)">Em Missão</span></td>
                    <td>${m.statusReason || '-'}</td>
                    <td>${formatDateBR(m.statusReturnDate)}</td>
                </tr>`;
            });
            missionList.innerHTML = `<div class="escala-table-wrap"><table class="escala-table"><thead><tr><th>Militar</th><th>Seção</th><th>Status</th><th>Destino</th><th>Retorno</th></tr></thead><tbody>${mRows}</tbody></table></div>`;
        }
    }

    // === Absent List ===
    const absentStatuses = ['licenca', 'afastado', 'ferias'];
    const absent = state.personnel
        .filter(m => {
            if (!m.status) return false;
            let st = m.status.toLowerCase().trim();
            if (st === 'férias') st = 'ferias';
            if (st === 'licença' || st === 'licença médica') st = 'licenca';
            return absentStatuses.includes(st);
        })
        .sort((a, b) => getRankWeight(a.rank) - getRankWeight(b.rank));

    
    const absentTitle = document.getElementById('absentTitle');
    const absentList = document.getElementById('absentList');
    if (!absentList) return;
    
    if (absent.length === 0) {
        absentTitle.style.display = 'none';
        absentList.innerHTML = '';
    } else {
        absentTitle.style.display = '';
        
        let rows = '';
        absent.forEach(m => {
            let st = (m.status || 'disponivel').toLowerCase().trim();
            if (st === 'férias') st = 'ferias';
            if (st === 'licença' || st === 'licença médica') st = 'licenca';
            const cfg = STATUS_CFG[st] || STATUS_CFG['disponivel'];
            const until = daysUntil(m.statusReturnDate);
            let returnStr = '-';
            let returnStyle = '';
            if (m.statusReturnDate) {
                returnStr = formatDateBR(m.statusReturnDate);
                if (until !== null && until <= 1) returnStyle = 'color:#ef4444;font-weight:600';
                else if (until !== null && until <= 3) returnStyle = 'color:#f59e0b;font-weight:600';
            }
            const initials = (m.warName||'?').substring(0,2).toUpperCase();
            const avatarHtml = m.photo
                ? `<img src="${m.photo}" class="escala-avatar-img" alt="">`
                : `<div class="escala-avatar">${initials}</div>`;
            rows += `
            <tr onclick="viewProfile('${m.id}')" style="cursor:pointer" onmouseover="this.style.background='var(--bg-tertiary)'" onmouseout="this.style.background='transparent'">
                <td><div style="display:flex;align-items:center;gap:10px">${avatarHtml}<strong>${m.rank} ${m.warName}</strong></div></td>
                <td>${m.section}</td>
                <td><span class="status-badge" style="color:${cfg.color};background:${cfg.bg}">${cfg.label}</span></td>
                <td>${m.statusReason || '-'}</td>
                <td>${formatDateBR(m.statusStartDate) || '-'}</td>
                <td style="${returnStyle}">${returnStr}${until !== null ? ` <small style="color:var(--text-secondary)">(${until}d)</small>` : ''}</td>
            </tr>`;
        });
        absentList.innerHTML = `
        <div class="escala-table-wrap">
            <table class="escala-table" style="width:100%">
                <thead><tr>
                    <th>Militar</th><th>Seção</th><th>Status</th><th>Motivo</th><th>Entrada</th><th>Previsão de Retorno</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
    }

    updateCharts();
    renderBirthdayList();
}

function renderBirthdayList() {
    const container = document.getElementById('birthdayList');
    if (!container) return;

    const today = new Date();
    const currentMonth = today.getMonth();
    const birthdayPersonnel = state.personnel.filter(m => {
        if (!m.birthDate) return false;
        const bDate = new Date(m.birthDate + 'T12:00:00');
        return bDate.getMonth() === currentMonth;
    }).sort((a, b) => {
        const d1 = new Date(a.birthDate + 'T12:00:00').getDate();
        const d2 = new Date(b.birthDate + 'T12:00:00').getDate();
        return d1 - d2;
    });

    const title = document.getElementById('birthdayTitle');
    if (birthdayPersonnel.length === 0) {
        if (title) title.style.display = 'none';
        container.innerHTML = '';
        return;
    }
    if (title) title.style.display = '';

    container.innerHTML = birthdayPersonnel.map(m => {
        const bDate = new Date(m.birthDate + 'T12:00:00');
        const day = bDate.getDate();
        const initials = (m.warName||'?').substring(0,2).toUpperCase();
        const isToday = day === today.getDate();
        
        return `
            <div class="glass-bg" style="padding:16px; border-radius:var(--radius-md); border:1px solid ${isToday ? 'var(--accent-color)' : 'var(--border-color)'}; display:flex; align-items:center; gap:12px; cursor:pointer; transition:var(--transition-base);" onclick="viewProfile('${m.id}')">
                <div style="background:${isToday ? 'var(--accent-color)' : 'var(--bg-tertiary)'}; color:${isToday ? 'white' : 'var(--accent-color)'}; width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:16px;">
                    ${day}
                </div>
                <div style="flex:1">
                    <div style="font-weight:700; color:var(--text-primary); font-size:14px;">${m.rank} ${m.warName}</div>
                    <div style="font-size:11px; color:var(--text-secondary);">${m.section}</div>
                </div>
                ${isToday ? '<span>🎂</span>' : ''}
            </div>
        `;
    }).join('');
}

function showTaskDetailsModal(type) {
    const titleEl = document.getElementById('infoModalTitle');
    const bodyEl = document.getElementById('infoModalBody');
    if (!bodyEl) return;
    
    bodyEl.innerHTML = '';
    let tasksToShow = [];
    const now = new Date();

    if (type === 'pendente') {
        titleEl.textContent = 'Tarefas Pendentes';
        tasksToShow = state.tasks.filter(t => t.status !== 'done');
    } else if (type === 'vencida') {
        titleEl.textContent = 'Tarefas Vencidas';
        tasksToShow = state.tasks.filter(t => t.status !== 'done' && t.deadline && new Date(t.deadline+'T23:59:59') < now);
    }

    if (tasksToShow.length === 0) {
        bodyEl.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding:20px;">Nenhuma tarefa encontrada.</p>';
    } else {
        tasksToShow.forEach(t => {
            const div = document.createElement('div');
            div.style.cssText = 'padding:12px; border-bottom:1px solid var(--border-color); display:flex; flex-direction:column; gap:4px;';
            
            const assigneeNames = (t.assignees || []).map(id => {
                const m = state.personnel.find(p => p.id === id);
                return m ? m.warName : 'Desconhecido';
            }).join(', ');

            div.innerHTML = `
                <div style="font-weight:600; font-size:14px; color:var(--text-primary)">${t.title}</div>
                <div style="font-size:12px; color:var(--text-secondary)">Responsável: ${assigneeNames || 'Não atribuído'}</div>
                <div style="font-size:12px; color:${type === 'vencida' ? '#ef4444' : 'var(--text-secondary)'}">Prazo: ${t.deadline ? formatDateBR(t.deadline) : 'Sem prazo'}</div>
            `;
            bodyEl.appendChild(div);
        });
    }

    openModal('infoModal');
}

function showOccurrenceDetailsModal(type, list) {
    const titleEl = document.getElementById('infoModalTitle');
    const bodyEl = document.getElementById('infoModalBody');
    if (!bodyEl) return;

    titleEl.textContent = `Ocorrências: ${type}`;
    bodyEl.innerHTML = '';

    const items = list.filter(o => o.type === type);
    
    if (items.length === 0) {
        bodyEl.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding:20px;">Nenhuma ocorrência encontrada.</p>';
    } else {
        items.forEach(o => {
            const m = state.personnel.find(p => p.id === o.militarId);
            const div = document.createElement('div');
            div.style.cssText = 'padding:12px; border-bottom:1px solid var(--border-color); display:flex; flex-direction:column; gap:4px; cursor:pointer; transition: background 0.2s;';
            div.onclick = () => {
                closeModal('infoModal');
                viewProfile(o.militarId);
            };
            div.onmouseover = () => div.style.background = 'var(--bg-tertiary)';
            div.onmouseout = () => div.style.background = 'transparent';

            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-weight:600; font-size:14px; color:var(--text-primary)">${m ? `${m.rank} ${m.warName}` : 'Desconhecido'}</div>
                    <div style="font-size:11px; color:var(--text-secondary)">${new Date(o.date+'T12:00:00').toLocaleDateString('pt-BR')}</div>
                </div>
                <div style="font-size:13px; color:var(--text-secondary); white-space:pre-wrap;">${o.description}</div>
            `;
            bodyEl.appendChild(div);
        });
    }

    openModal('infoModal');
}

function renderBirthdayList() {
    const container = document.getElementById('birthdayList');
    if (!container) return;

    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentDay = now.getDate();

    const birthdays = state.personnel.filter(m => {
        if (!m.birthDate) return false;
        const [y, mth, day] = m.birthDate.split('-').map(Number);
        return mth === currentMonth;
    }).sort((a, b) => {
        const dayA = parseInt(a.birthDate.split('-')[2]);
        const dayB = parseInt(b.birthDate.split('-')[2]);
        return dayA - dayB;
    });

    if (birthdays.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary); font-size:13px; padding:10px;">Nenhum aniversariante este mês.</p>';
        return;
    }

    container.innerHTML = birthdays.map(m => {
        const [y, mth, day] = m.birthDate.split('-').map(Number);
        const isToday = day === currentDay;
        
        // Estilo especial para hoje
        const cardBg = isToday ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-secondary)';
        const cardBorder = isToday ? '1px solid #3b82f6' : '1px solid var(--border-color)';
        const dateBg = isToday ? '#3b82f6' : 'var(--bg-tertiary)';
        const dateColor = isToday ? '#fff' : 'var(--text-secondary)';

        const initials = (m.warName||'?').substring(0,2).toUpperCase();
        const avatarHtml = m.photo
            ? `<img src="${m.photo}" style="width:32px; height:32px; border-radius:50%; object-fit:cover; border: 1px solid var(--border-color);">`
            : `<div style="width:32px; height:32px; border-radius:50%; background:var(--bg-tertiary); display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:bold;">${initials}</div>`;

        return `
            <div style="background:${cardBg}; border:${cardBorder}; padding:12px; border-radius:12px; display:flex; align-items:center; gap:12px; transition: transform 0.2s; cursor: pointer;" onclick="viewProfile('${m.id}')" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
                <div style="background:${dateBg}; color:${dateColor}; min-width:38px; height:42px; border-radius:10px; display:flex; flex-direction:column; align-items:center; justify-content:center; font-weight:bold; line-height:1;">
                    <span style="font-size:10px; opacity:0.8; margin-bottom:2px;">${day}</span>
                    <span style="font-size:12px;">${getMonthAbbr(mth)}</span>
                </div>
                <div style="flex:1; min-width:0;">
                    <div style="display:flex; align-items:center; gap:6px;">
                        <span style="font-size:13px; font-weight:600; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${m.rank} ${m.warName}</span>
                        ${isToday ? '<span>🎂</span>' : ''}
                    </div>
                    <div style="font-size:11px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${m.section}</div>
                </div>
                ${avatarHtml}
            </div>
        `;
    }).join('');
}

function getMonthAbbr(m) {
    const months = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
    return months[m-1];
}

let currentEscalaFilter = 'all';

// === ESCALA DE SERVIÇO ===
function renderEscala() {
    const summary = document.getElementById('statusSummary');
    summary.innerHTML = '';
    
    // Preparar cards agrupados
    const groups = [
        { key: 'all', label: 'Todos', color: '#64748b', bg: 'rgba(100,116,139,.1)' },
        ...Object.entries(STATUS_CFG)
            .filter(([k]) => !['adido', 'encostado', 'reintegrado'].includes(k))
            .map(([k, v]) => ({ key: k, ...v })),
        { key: 'excedentes', label: 'Adidos/Exced.', color: '#64748b', bg: 'rgba(100,116,139,.15)' }
    ];

    groups.forEach(cfg => {
        let count = 0;
        if (cfg.key === 'all') {
            count = state.personnel.filter(m => m.section !== "Adidos/Encostados/Reintegrados").length;
        } else if (cfg.key === 'excedentes') {
            count = state.personnel.filter(m => ['adido', 'encostado', 'reintegrado'].includes(m.status)).length;
        } else {
            count = state.personnel.filter(m => (m.status || 'disponivel') === cfg.key).length;
        }

        const d = document.createElement('div');
        d.className = 'status-card';
        const isSelected = currentEscalaFilter === cfg.key;
        
        d.style.cssText = `border-left:4px solid ${cfg.color}; cursor:pointer; transition:all 0.2s; background: ${isSelected ? cfg.bg : 'var(--bg-secondary)'};`;
        
        if (!isSelected && currentEscalaFilter !== 'all' && cfg.key !== 'all') {
            d.style.opacity = '0.6';
        }

        d.onclick = () => {
            currentEscalaFilter = cfg.key;
            renderEscala();
        };

        d.innerHTML = `
            <div style="font-size:12px; color:var(--text-secondary)">${cfg.label}</div>
            <div style="font-size:20px; font-weight:bold; color:${cfg.color}">${count}</div>
        `;

        if (['ferias', 'licenca', 'afastado'].includes(cfg.key)) {
            const btnAdd = document.createElement('button');
            btnAdd.className = 'btn-status-add';
            btnAdd.innerHTML = '<i data-lucide="plus"></i>';
            btnAdd.onclick = (e) => {
                e.stopPropagation();
                quickChangeStatus(null, cfg.key);
            };
            d.appendChild(btnAdd);
            lucide.createIcons({ props: { width: 14, height: 14 }, root: btnAdd });
        }
        
        summary.appendChild(d);
    });

    const tbody = document.getElementById('escalaBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const searchInput = document.getElementById('searchEscala');
    const search = (searchInput?.value || '').toLowerCase();
    
    const filtered = state.personnel.filter(m => {
        const st = m.status || 'disponivel';
        let matchStatus = false;
        if (currentEscalaFilter === 'all') matchStatus = true;
        else if (currentEscalaFilter === 'excedentes') matchStatus = ['adido', 'encostado', 'reintegrado'].includes(st);
        else matchStatus = st === currentEscalaFilter;

        const matchSearch = (m.warName + m.fullName + m.rank).toLowerCase().includes(search);
        return matchStatus && matchSearch;
    });

    const sorted = [...filtered].sort((a,b) => {
        const weightA = getRankWeight(a.rank);
        const weightB = getRankWeight(b.rank);
        if (weightA !== weightB) return weightA - weightB;
        return (a.warName || '').localeCompare(b.warName || '');
    });
    sorted.forEach(m => {
        const st = m.status || 'disponivel';
        const cfg = STATUS_CFG[st];
        const avatarHtml = m.photo
            ? `<img src="${m.photo}" class="escala-avatar-img" alt="">`
            : `<div class="escala-avatar">${(m.warName||'?').substring(0,2).toUpperCase()}</div>`;
        const reasonText = m.statusReason ? ` (${m.statusReason})` : '';
        const returnText = m.statusReturnDate ? ` · Retorno: ${formatDateBR(m.statusReturnDate)}` : '';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><div style="display:flex;align-items:center;gap:10px">
                ${avatarHtml}
                <div><strong>${m.rank} ${m.warName}</strong><br><small>${m.fullName}</small></div>
            </div></td>
            <td>${m.section}</td>
            <td>${m.function}</td>
            <td><span class="status-badge" style="color:${cfg.color};background:${cfg.bg}" title="${m.statusReason||''}">${cfg.label}${reasonText}${returnText}</span></td>
            <td data-html2canvas-ignore>
                <select class="escala-status-select" onchange="quickChangeStatus('${m.id}', this.value)">
                    ${Object.entries(STATUS_CFG).map(([k,c]) => 
                        k === 'missao' && st !== 'missao' 
                        ? `<option value="${k}" disabled>Em Missão (Use aba Missões)</option>`
                        : `<option value="${k}" ${st===k?'selected':''}>${c.label}</option>`).join('')}
                </select>
            </td>`;
        tbody.appendChild(tr);
    });
}

function quickChangeStatus(id, newStatus) {
    const m = id ? state.personnel.find(x => x.id === id) : null;
    const needsDetail = newStatus === 'licenca' || newStatus === 'afastado' || newStatus === 'ferias';
    
    if (needsDetail) {
        const cfg = STATUS_CFG[newStatus];
        document.getElementById('scMilId').value = id || '';
        document.getElementById('scNewStatus').value = newStatus;
        document.getElementById('scStatusBadge').textContent = cfg.label;
        document.getElementById('scStatusBadge').style.color = cfg.color;
        document.getElementById('scStatusBadge').style.background = cfg.bg;
        document.getElementById('scReason').value = m ? (m.statusReason || '') : '';
        document.getElementById('scDays').value = '';
        document.getElementById('scStartDate').value = new Date().toISOString().split('T')[0];
        
        const milSelectContainer = document.getElementById('scMilSelectContainer');
        const milSelect = document.getElementById('scMilSelect');
        
        if (!id) {
            milSelectContainer.style.display = 'block';
            milSelect.innerHTML = state.personnel
                .sort((a,b) => getRankWeight(a.rank) - getRankWeight(b.rank))
                .map(p => `<option value="${p.id}">${p.rank} ${p.warName} (${p.section})</option>`)
                .join('');
        } else {
            milSelectContainer.style.display = 'none';
        }
        
        openModal('statusChangeModal');
    } else if (id) {
        const oldStatus = m.status || 'disponivel';
        m.status = newStatus;
        
        // Se mudar para adido/encostado/reintegrado, sugere mudar de seção também
        if (['adido', 'encostado', 'reintegrado'].includes(newStatus) && m.section !== "Adidos/Encostados/Reintegrados") {
            if (confirm(`Deseja mover ${m.rank} ${m.warName} para a seção "Adidos/Encostados/Reintegrados"?`)) {
                m.section = 'Adidos/Encostados/Reintegrados';
            }
        }
        
        m.statusReason = '';
        m.statusReturnDate = null;
        m.statusStartDate = null;
        recordStatusHistory(id, oldStatus, newStatus, 'Alteração rápida');
        saveState(); renderDashboard(); renderEscala(); renderPersonnelList();
    }
}

function recordStatusHistory(militarId, oldStatus, newStatus, reason) {
    if (oldStatus === newStatus) return;
    state.statusHistory.push({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        militarId,
        oldStatus,
        newStatus,
        reason: reason || '-',
        date: new Date().toISOString()
    });
}

// === FOTO DE PERFIL ===
function setupPhotoUpload() {
    const input = document.getElementById('milPhoto');
    input.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            pendingPhoto = ev.target.result;
            showPhotoPreview(pendingPhoto);
            document.getElementById('btnRemovePhoto').style.display = 'inline-flex';
        };
        reader.readAsDataURL(file);
    });
    document.getElementById('btnRemovePhoto').addEventListener('click', () => {
        pendingPhoto = '__remove__';
        clearPhotoPreview();
        document.getElementById('milPhoto').value = '';
        document.getElementById('btnRemovePhoto').style.display = 'none';
    });
}

function showPhotoPreview(src) {
    document.getElementById('photoInitials').style.display = 'none';
    const img = document.getElementById('photoImg');
    img.src = src; img.style.display = 'block';
}

function clearPhotoPreview(initials) {
    document.getElementById('photoImg').style.display = 'none';
    document.getElementById('photoImg').src = '';
    const el = document.getElementById('photoInitials');
    el.style.display = 'block';
    el.textContent = initials || '?';
}

function resetPersonnelForm() {
    document.getElementById('personnelForm').reset();
    document.getElementById('milId').value = '';
    document.getElementById('milStatusReason').value = '';
    document.getElementById('milStatusDays').value = '';
    document.getElementById('milStatusStartDate').value = '';
    document.getElementById('groupStatusReason').style.display = 'none';
    document.getElementById('groupStatusDays').style.display = 'none';
    document.getElementById('groupStatusStartDate').style.display = 'none';
    pendingPhoto = null;
    clearPhotoPreview('?');
    document.getElementById('btnRemovePhoto').style.display = 'none';
}

// === FORM PESSOAL ===
function setupPersonnelForm() {
    setupPhotoUpload();
    
    document.getElementById('milStatus').addEventListener('change', e => {
        const val = e.target.value;
        const showExtra = (val === 'licenca' || val === 'afastado' || val === 'ferias');
        document.getElementById('groupStatusReason').style.display = showExtra ? 'block' : 'none';
        document.getElementById('groupStatusDays').style.display = showExtra ? 'block' : 'none';
        document.getElementById('groupStatusStartDate').style.display = showExtra ? 'block' : 'none';
    });

    document.getElementById('btnConfirmStatusChange').addEventListener('click', () => {
        let id = document.getElementById('scMilId').value;
        if (!id) {
            id = document.getElementById('scMilSelect').value;
        }
        const newStatus = document.getElementById('scNewStatus').value;
        const reason = document.getElementById('scReason').value;
        const days = document.getElementById('scDays').value;
        const startDate = document.getElementById('scStartDate').value;
        const m = state.personnel.find(x => x.id === id);
        if (!m) return;
        const oldStatus = m.status || 'disponivel';
        m.status = newStatus;
        
        // Se mudar para adido/encostado/reintegrado, sugere mudar de seção também
        if (['adido', 'encostado', 'reintegrado'].includes(newStatus) && m.section !== "Adidos/Encostados/Reintegrados") {
            if (confirm(`Deseja mover ${m.rank} ${m.warName} para a seção "Adidos/Encostados/Reintegrados"?`)) {
                m.section = 'Adidos/Encostados/Reintegrados';
            }
        }

        m.statusReason = reason;
        m.statusStartDate = startDate || null;
        m.statusReturnDate = (days && parseInt(days) > 0) ? calcReturnDateFrom(startDate, days) : null;
        recordStatusHistory(id, oldStatus, newStatus, reason);
        closeModal('statusChangeModal');
        saveState();
        renderDashboard(); renderEscala(); renderPersonnelList();
        if (currentProfileId && document.getElementById('profileView').classList.contains('active')) {
            viewProfile(currentProfileId);
        }
    });

    document.getElementById('personnelForm').addEventListener('submit', e => {
        e.preventDefault();
        const id = document.getElementById('milId').value;
        const existing = id ? state.personnel.find(m => m.id === id) : null;

        let photo = existing ? existing.photo : null;
        if (pendingPhoto === '__remove__') photo = null;
        else if (pendingPhoto) photo = pendingPhoto;

        const statusVal = document.getElementById('milStatus').value;
        const statusDays = document.getElementById('milStatusDays').value;

        const isDetailedStatus = (statusVal === 'licenca' || statusVal === 'afastado' || statusVal === 'ferias');
        
        const mil = {
            id:       id || Date.now().toString(),
            rank:     document.getElementById('milRank').value,
            warName:  document.getElementById('milWarName').value,
            fullName: document.getElementById('milFullName').value,
            section:  document.getElementById('milSection').value,
            function: document.getElementById('milFunction').value,
            status:   statusVal,
            statusReason: isDetailedStatus ? document.getElementById('milStatusReason').value : '',
            statusStartDate: isDetailedStatus ? (document.getElementById('milStatusStartDate').value || (existing ? existing.statusStartDate : null)) : null,
            statusReturnDate: (isDetailedStatus && statusDays && parseInt(statusDays) > 0)
                ? calcReturnDateFrom(document.getElementById('milStatusStartDate').value, statusDays)
                : (isDetailedStatus && existing ? existing.statusReturnDate : null),
            phone:    document.getElementById('milPhone').value,
            birthDate:document.getElementById('milBirthDate').value,
            address:  document.getElementById('milAddress').value,
            skills:   document.getElementById('milSkills').value,
            notes:    document.getElementById('milNotes').value,
            photo,
            createdBy: existing ? existing.createdBy : (currentUser ? currentUser.uid : 'system'),
            createdByRole: existing ? existing.createdByRole : (hasPermission('isAdmin') ? 'admin' : 'operator')
        };

        if (id) {
            const idx = state.personnel.findIndex(m => m.id === id);
            if (idx !== -1) {
                const oldStatus = state.personnel[idx].status || 'disponivel';
                if (oldStatus !== mil.status) {
                    recordStatusHistory(id, oldStatus, mil.status, mil.statusReason);
                }
                state.personnel[idx] = mil;
            }
        } else {
            state.personnel.push(mil);
            recordStatusHistory(mil.id, 'novo', mil.status, 'Inclusão inicial');
        }
        closeModal('personnelModal');
        saveState();
        renderPersonnelList();
        renderDashboard();
        renderEscala();
        if (currentProfileId && document.getElementById('profileView').classList.contains('active')) {
            viewProfile(currentProfileId);
        }
    });
}

// === DIRETÓRIO DE PESSOAL ===
function renderPersonnelList() {
    const list = document.getElementById('personnelList');
    const search = document.getElementById('searchPersonnel').value.toLowerCase();
    const secFilter = document.getElementById('filterSection').value;

    const filtered = state.personnel.filter(m => {
        const matchSearch = (m.warName+m.fullName+m.rank).toLowerCase().includes(search);
        const matchSec    = secFilter === 'all' || m.section === secFilter;
        return matchSearch && matchSec;
    });

    if (!filtered.length) {
        list.innerHTML = '<p style="color:var(--text-secondary);grid-column:1/-1">Nenhum militar encontrado.</p>';
        return;
    }

    list.innerHTML = '';
    
    // Group by section
    const grouped = {};
    SECTIONS.forEach(s => grouped[s] = []); // Ensure order
    filtered.forEach(m => {
        if (!grouped[m.section]) grouped[m.section] = [];
        grouped[m.section].push(m);
    });

    Object.keys(grouped).forEach(section => {
        if (grouped[section].length === 0) return;
        
        // Sort by rank, then alphabetically by warName
        grouped[section].sort((a, b) => {
            const weightA = getRankWeight(a.rank);
            const weightB = getRankWeight(b.rank);
            if (weightA !== weightB) return weightA - weightB;
            return (a.warName || '').localeCompare(b.warName || '');
        });

        // Create Section Header
        const sectionWrap = document.createElement('div');
        sectionWrap.style.gridColumn = '1 / -1';
        sectionWrap.style.marginBottom = '24px';
        
        const header = document.createElement('h3');
        header.innerHTML = `${section} <i data-lucide="chevron-down" class="collapse-icon"></i>`;
        header.style.marginBottom = '12px';
        header.style.color = 'var(--accent-color)';
        header.style.borderBottom = '2px solid var(--border-color)';
        header.style.paddingBottom = '8px';
        header.style.cursor = 'pointer';
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        sectionWrap.appendChild(header);

        // Create Table
        const tableWrap = document.createElement('div');
        tableWrap.className = 'escala-table-wrap';
        
        // Auto-expandir se houver uma busca ativa, ou se já estava expandido manualmente
        const query = document.getElementById('searchPersonnel')?.value || '';
        const isExpanded = expandedSections.has(section) || query.length > 0;
        tableWrap.style.display = isExpanded ? '' : 'none';
        
        header.onclick = () => {
            const icon = header.querySelector('.collapse-icon');
            if (tableWrap.style.display === 'none') {
                tableWrap.style.display = '';
                expandedSections.add(section);
                if(icon) {
                    icon.setAttribute('data-lucide', 'chevron-up');
                    if(window.lucide) window.lucide.createIcons({nameAttr: 'data-lucide'});
                }
            } else {
                tableWrap.style.display = 'none';
                expandedSections.delete(section);
                if(icon) {
                    icon.setAttribute('data-lucide', 'chevron-down');
                    if(window.lucide) window.lucide.createIcons({nameAttr: 'data-lucide'});
                }
            }
        };
        
        // Update icon if already expanded
        if (isExpanded) {
            const icon = header.querySelector('.collapse-icon');
            if (icon) icon.setAttribute('data-lucide', 'chevron-up');
        }
        
        let tbodyHtml = '';
        grouped[section].forEach(m => {
            const st = m.status || 'disponivel';
            const cfg = STATUS_CFG[st] || STATUS_CFG['disponivel'];
            const initials = (m.warName||'?').substring(0,2).toUpperCase();
            const avatarHtml = m.photo
                ? `<img src="${m.photo}" class="escala-avatar-img" alt="">`
                : `<div class="escala-avatar">${initials}</div>`;
                
            const isAvailable = st === 'disponivel';
            const reasonText = (!isAvailable && m.statusReason) ? ` (${m.statusReason})` : '';
            const returnText = (!isAvailable && m.statusReturnDate) ? ` · Retorno: ${formatDateBR(m.statusReturnDate)}` : '';
            const canEdit = hasPermission('managePersonnel') && checkAuthorRule(m);
            const canDelete = hasPermission('deletePersonnel') && checkAuthorRule(m);

            tbodyHtml += `
            <tr class="personnel-row" style="cursor:pointer; transition: background 0.2s;" onclick="viewProfile('${m.id}')" onmouseover="this.style.background='var(--bg-tertiary)'" onmouseout="this.style.background='transparent'">
                <td>
                    <div style="display:flex;align-items:center;gap:10px">
                        ${avatarHtml}
                        <div><strong>${m.rank} ${m.warName}</strong></div>
                    </div>
                </td>
                <td style="color:var(--text-secondary)">${m.function || '-'}</td>
                <td><span class="status-badge" style="color:${cfg.color};background:${cfg.bg}">${cfg.label}${reasonText}${returnText}</span></td>
                <td style="text-align:right" data-html2canvas-ignore>
                    ${canEdit ? `<button class="icon-btn" onclick="event.stopPropagation(); editPersonnel(event,'${m.id}')"><i data-lucide="edit-2"></i></button>` : ''}
                    ${canDelete ? `<button class="icon-btn delete" onclick="event.stopPropagation(); deletePersonnel(event,'${m.id}')"><i data-lucide="trash-2"></i></button>` : ''}
                </td>
            </tr>`;
        });

        tableWrap.innerHTML = `
            <table class="escala-table" style="width:100%">
                <thead>
                    <tr>
                        <th>Militar</th>
                        <th>Função</th>
                        <th>Status</th>
                        <th style="text-align:right" data-html2canvas-ignore>Ações</th>
                    </tr>
                </thead>
                <tbody>${tbodyHtml}</tbody>
            </table>`;
            
        sectionWrap.appendChild(tableWrap);
        list.appendChild(sectionWrap);
    });
    
    if(window.lucide) window.lucide.createIcons();
}

function editPersonnel(event, id) {
    event.stopPropagation();
    const m = state.personnel.find(x => x.id === id);
    if (!m) return;
    resetPersonnelForm();
    document.getElementById('milId').value       = m.id;
    document.getElementById('milRank').value     = m.rank;
    document.getElementById('milWarName').value  = m.warName;
    document.getElementById('milFullName').value = m.fullName;
    document.getElementById('milSection').value  = m.section;
    document.getElementById('milFunction').value = m.function;
    document.getElementById('milStatus').value   = m.status || 'disponivel';
    document.getElementById('milStatusReason').value = m.statusReason || '';
    document.getElementById('milStatusDays').value = ''; // days not stored, only returnDate
    const showExtra = (m.status === 'licenca' || m.status === 'afastado' || m.status === 'ferias');
    document.getElementById('groupStatusReason').style.display = showExtra ? 'block' : 'none';
    document.getElementById('groupStatusDays').style.display = showExtra ? 'block' : 'none';
    document.getElementById('milPhone').value    = m.phone || '';
    document.getElementById('milBirthDate').value= m.birthDate || '';
    document.getElementById('milAddress').value  = m.address || '';
    document.getElementById('milSkills').value   = m.skills || '';
    document.getElementById('milNotes').value    = m.notes || '';
    if (m.photo) {
        showPhotoPreview(m.photo);
        document.getElementById('btnRemovePhoto').style.display = 'inline-flex';
    } else {
        clearPhotoPreview((m.warName||'?').substring(0,2).toUpperCase());
    }
    document.getElementById('personnelModalTitle').textContent = 'Editar Militar';
    openModal('personnelModal');
}

function deletePersonnel(event, id) {
    event.stopPropagation();
    if (confirm('Excluir este militar?')) {
        state.personnel   = state.personnel.filter(m => m.id !== id);
        state.tasks       = state.tasks.filter(t => t.assigneeId !== id);
        state.occurrences = state.occurrences.filter(o => o.militarId !== id);
        saveState();
        renderPersonnelList();
        renderDashboard();
        renderEscala();
        updateAssigneeSelects();
        renderTasks();
    }
}

// === PERFIL ===
function viewProfile(id) {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
    const m = state.personnel.find(x => x.id === id);
    if (!m) return;
    currentProfileId = id;

    const initials = (m.warName||'?').substring(0,2).toUpperCase();
    const st  = m.status || 'disponivel';
    const cfg = STATUS_CFG[st];
    const avatarHtml = m.photo
        ? `<img src="${m.photo}" style="width:80px;height:80px;border-radius:50%;object-fit:cover" alt="">`
        : `<div class="profile-avatar-large">${initials}</div>`;

    let age = '-';
    if (m.birthDate) {
        const diff = Date.now() - new Date(m.birthDate).getTime();
        age = Math.floor(diff / (1000*60*60*24*365.25)) + ' anos';
    }

    const userTasks = state.tasks.filter(t => t.assigneeId === id);
    const tasksHtml = userTasks.length
        ? userTasks.map(t => {
            const pc = PRIORITY_CFG[t.priority||'media'];
            const statusLabel = {todo:'A Fazer',progress:'Em Andamento',done:'Concluído'}[t.status];
            return `<div class="occ-item" style="border:1px solid var(--border-color);border-radius:8px;padding:12px;margin-bottom:8px">
                <span style="font-weight:500">${t.title}</span>
                <div style="display:flex;gap:6px;margin-top:8px">
                    <span class="status-badge" style="color:${pc.color};background:${pc.bg}">${pc.label}</span>
                    <span class="mil-section-badge">${statusLabel}</span>
                </div>
            </div>`;
        }).join('')
        : '<p style="color:var(--text-secondary)">Nenhuma tarefa designada.</p>';

    // Filtro de Ocorrências baseado em regras
    const isCbSd = (m.rank === 'Cb' || m.rank === 'Sd');
    const occs = state.occurrences
        .filter(o => o.militarId === id)
        .filter(o => {
            if (hasPermission('viewRestricted')) return true;
            // Sem permissão especial, só vê Cb/Sd
            if (!isCbSd) return false;
            // Sem permissão especial, não vê coisas do Admin
            if (o.createdByRole === 'admin' && !hasPermission('isAdmin')) return false;
            return true;
        })
        .sort((a,b) => new Date(b.date) - new Date(a.date));

    const occsHtml = occs.length
        ? occs.map(o => {
            const oc = OCC_CFG[o.type] || { color: '#8b5cf6' };
            const canDeleteOcc = hasPermission('addOccurrences') && checkAuthorRule(o);
            return `<div class="occ-item" style="border:1px solid var(--border-color);border-radius:8px;padding:12px;margin-bottom:8px">
                <div style="display:flex;align-items:center;gap:10px">
                    <span class="status-badge" style="color:${oc.color};background:${oc.color}20">${o.type}</span>
                    <span style="font-size:13px;color:var(--text-secondary)">${new Date(o.date+'T12:00:00').toLocaleDateString('pt-BR')}</span>
                </div>
                <p style="margin-top:6px;font-size:14px;white-space:pre-wrap">${o.description}</p>
                ${canDeleteOcc ? `
                <button class="icon-btn delete" style="margin-top:8px" onclick="deleteOccurrence('${o.id}')">
                    <i data-lucide="trash-2"></i>
                </button>` : ''}
            </div>`;
        }).join('')
        : '<p style="color:var(--text-secondary)">Nenhuma ocorrência registrada.</p>';

    document.getElementById('profileContent').innerHTML = `
        <div class="profile-header">
            ${avatarHtml}
            <div>
                <h2>${m.rank} ${m.warName}</h2>
                <p>${m.fullName}</p>
                <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
                    <span class="mil-section-badge">${m.section}</span>
                    <span class="status-badge" style="color:${cfg.color};background:${cfg.bg}" title="${m.statusReason||''}">${cfg.label}${m.statusReason ? ` (${m.statusReason})` : ''}</span>
                </div>
            </div>
            <div class="profile-actions">
                ${(hasPermission('managePersonnel') && checkAuthorRule(m)) ? 
                `<button class="btn btn-outline" onclick="editPersonnel(event,'${m.id}')"><i data-lucide="edit"></i> Editar</button>` : ''}
            </div>
        </div>
        <div class="profile-details-grid">
            <div class="detail-item"><label>Função</label><p>${m.function}</p></div>
            <div class="detail-item"><label>Telefone</label><p>${m.phone||'-'}</p></div>
            <div class="detail-item"><label>Data de Nascimento</label><p>${m.birthDate ? new Date(m.birthDate+'T12:00:00').toLocaleDateString('pt-BR') : '-'} (${age})</p></div>
            ${(m.statusReason) ? `<div class="detail-item"><label>Motivo do Afastamento</label><p>${m.statusReason}</p></div>` : ''}
            ${(m.statusReturnDate) ? `<div class="detail-item"><label>Previsão de Retorno</label><p style="font-weight:600;color:var(--accent-color)">${formatDateBR(m.statusReturnDate)}</p></div>` : ''}
            <div class="detail-item full-width"><label>Endereço</label><p>${m.address||'-'}</p></div>
            <div class="detail-item full-width"><label>Especialidades</label><p>${m.skills||'-'}</p></div>
            <div class="detail-item full-width"><label>Observações</label><p style="white-space:pre-wrap">${m.notes||'-'}</p></div>
        </div>
        <hr style="border:0;border-top:1px solid var(--border-color);margin:24px 0">
        <h3 style="margin-bottom:12px;font-size:16px">Tarefas Designadas</h3>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:24px">${tasksHtml}</div>
        <hr style="border:0;border-top:1px solid var(--border-color);margin:24px 0">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h3 style="font-size:16px">Histórico de Ocorrências</h3>
            ${hasPermission('addOccurrences') ? `
            <button class="btn btn-primary" onclick="openOccurrenceModal('${m.id}')">
                <i data-lucide="plus"></i> Nova Ocorrência
            </button>` : ''}
        </div>
        <div id="occList" style="display:flex;flex-direction:column;gap:10px">${occsHtml}</div>
        <hr style="border:0;border-top:1px solid var(--border-color);margin:24px 0">
        <h3 style="margin-bottom:12px;font-size:16px">Histórico de Movimentação</h3>
        <div id="statusHistoryList" style="display:flex;flex-direction:column;gap:8px;margin-bottom:24px">
            ${renderStatusHistory(id)}
        </div>
        <hr style="border:0;border-top:1px solid var(--border-color);margin:24px 0">
        <h3 style="margin-bottom:12px;font-size:16px">Missões Participadas</h3>
        <div id="profileMissionHistory" style="display:flex;flex-direction:column;gap:8px">
            ${renderMissionHistoryForProfile(id)}
        </div>`;

    lucide.createIcons();
    showView('profile');
}

function renderStatusHistory(militarId) {
    const hist = state.statusHistory
        .filter(h => h.militarId === militarId)
        .sort((a,b) => new Date(b.date) - new Date(a.date));
    
    if (hist.length === 0) return '<p style="color:var(--text-secondary)">Nenhum registro de movimentação.</p>';

    return hist.map(h => {
        const oldCfg = STATUS_CFG[h.oldStatus] || { label: h.oldStatus, color: '#666' };
        const newCfg = STATUS_CFG[h.newStatus] || { label: h.newStatus, color: '#666' };
        return `
            <div style="font-size:13px;padding:10px;background:var(--bg-tertiary);border-radius:8px;display:flex;flex-direction:column;gap:4px">
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <div style="display:flex;align-items:center;gap:6px">
                        <span style="color:var(--text-secondary)">${oldCfg.label}</span>
                        <i data-lucide="arrow-right" style="width:12px;height:12px"></i>
                        <span style="font-weight:600;color:${newCfg.color}">${newCfg.label}</span>
                    </div>
                    <span style="font-size:11px;color:var(--text-secondary)">${new Date(h.date).toLocaleString('pt-BR')}</span>
                </div>
                ${h.reason && h.reason !== '-' ? `<div style="font-size:12px;color:var(--text-secondary);font-style:italic">Motivo: ${h.reason}</div>` : ''}
            </div>
        `;
    }).join('');
}

function renderMissionHistoryForProfile(militarId) {
    const missions = state.missions.filter(m => m.personnelIds.includes(militarId))
        .sort((a,b) => new Date(b.startDate) - new Date(a.startDate));

    if (missions.length === 0) return '<p style="color:var(--text-secondary)">Nenhuma missão registrada para este militar.</p>';

    return missions.map(m => {
        const isCompleted = m.status === 'concluida';
        const color = isCompleted ? '#10b981' : '#3b82f6';
        return `
            <div style="font-size:13px;padding:12px;background:var(--bg-tertiary);border-radius:8px;border-left:3px solid ${color}">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                    <span style="font-weight:600;color:${color}">${m.reason}</span>
                    <span style="font-size:11px;color:var(--text-secondary)">${isCompleted ? 'Concluída' : 'Em Andamento'}</span>
                </div>
                <div style="font-size:12px;color:var(--text-secondary)">
                    <i data-lucide="calendar" style="width:12px;height:12px;vertical-align:middle"></i> 
                    ${formatDateBR(m.startDate)} até ${formatDateBR(m.endDate)}
                </div>
                ${m.notes ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:6px;font-style:italic">Obs: ${m.notes}</div>` : ''}
            </div>
        `;
    }).join('');
}

// ============================================================
// PART 3: TAREFAS E OCORRÊNCIAS
// ============================================================

// === TAREFAS ===
let currentTaskSelectedIds = new Set();

function updateAssigneeSelects() {
    const listContainer = document.getElementById('taskAssigneeList');
    const tagsContainer = document.getElementById('selectedAssigneeTags');
    const selFilt = document.getElementById('filterTaskAssignee');
    const searchInput = document.getElementById('taskAssigneeSearch');
    
    // Only initialize from DOM if the set is empty (first open)
    if (currentTaskSelectedIds.size === 0) {
        const checked = Array.from(document.querySelectorAll('input[name="taskAssignees"]:checked'));
        checked.forEach(cb => currentTaskSelectedIds.add(cb.value));
    }

    const renderTags = () => {
        if (!tagsContainer) return;
        const selected = state.personnel.filter(m => currentTaskSelectedIds.has(m.id));
        tagsContainer.innerHTML = selected.map(m => `
            <div class="status-badge" style="background:var(--accent-color); color:white; display:flex; align-items:center; gap:6px; padding:4px 10px; border-radius:12px; font-size:12px;">
                ${m.rank} ${m.warName}
                <i data-lucide="x" style="width:12px; height:12px; cursor:pointer" onclick="toggleAssigneeSelection('${m.id}', false)"></i>
            </div>
        `).join('');
        lucide.createIcons();
    };

    const renderCheckboxes = (filter = '') => {
        const query = filter.toLowerCase();
        const filtered = state.personnel
            .filter(m => (m.rank + ' ' + m.warName).toLowerCase().includes(query))
            .sort((a,b) => a.warName.localeCompare(b.warName));
            
        if (listContainer) {
            listContainer.innerHTML = filtered.map(m => `
                <label style="display:flex; align-items:center; gap:8px; padding:4px 0; cursor:pointer; font-size:13px;">
                    <input type="checkbox" name="taskAssignees" value="${m.id}" ${currentTaskSelectedIds.has(m.id) ? 'checked' : ''} onchange="toggleAssigneeSelection('${m.id}', this.checked)">
                    ${m.rank} ${m.warName}
                </label>
            `).join('') || '<p style="font-size:12px; color:var(--text-secondary)">Nenhum militar encontrado.</p>';
        }
    };

    window.toggleAssigneeSelection = (id, isChecked) => {
        if (isChecked) currentTaskSelectedIds.add(id);
        else currentTaskSelectedIds.delete(id);
        
        // Update checkboxes in the list if visible
        const cb = document.querySelector(`input[name="taskAssignees"][value="${id}"]`);
        if (cb) cb.checked = isChecked;
        
        renderTags();
    };

    const html = '<option value="all">Todos os Militares</option>' +
        [...state.personnel].sort((a,b)=>a.warName.localeCompare(b.warName))
        .map(m => `<option value="${m.id}">${m.rank} ${m.warName}</option>`).join('');

    renderTags();
    renderCheckboxes();
    if (selFilt) selFilt.innerHTML = html;

    if (searchInput && !searchInput.dataset.initialized) {
        searchInput.addEventListener('input', (e) => renderCheckboxes(e.target.value));
        searchInput.dataset.initialized = 'true';
    }
}

function setupTaskForm() {
    document.getElementById('taskForm').addEventListener('submit', e => {
        e.preventDefault();
        const id = document.getElementById('taskId').value;
        const task = {
            id:         id || Date.now().toString(),
            title:      document.getElementById('taskTitle').value,
            assigneeIds: Array.from(currentTaskSelectedIds),
            status:     document.getElementById('taskStatus').value,
            priority:   document.getElementById('taskPriority').value,
            deadline:   document.getElementById('taskDeadline').value,
            description:document.getElementById('taskDescription').value,
            createdAt:  id ? state.tasks.find(t=>t.id===id).createdAt : new Date().toISOString(),
            createdBy:  id ? state.tasks.find(t=>t.id===id).createdBy : (currentUser ? currentUser.uid : 'system'),
            createdByRole: id ? state.tasks.find(t=>t.id===id).createdByRole : (hasPermission('isAdmin') ? 'admin' : 'operator')
        };

        if (id) {
            const idx = state.tasks.findIndex(t => t.id === id);
            if (idx !== -1) state.tasks[idx] = task;
        } else {
            state.tasks.push(task);
        }
        closeModal('taskModal');
        saveState();
        renderTasks();
        renderDashboard();
        if (currentProfileId && document.getElementById('profileView').classList.contains('active')) {
            viewProfile(currentProfileId);
        }
    });
}

function renderTasks() {
    const todo = document.getElementById('tasksTodo');
    const prog = document.getElementById('tasksProgress');
    const done = document.getElementById('tasksDone');
    if (!todo || !prog || !done) return;

    todo.innerHTML = ''; prog.innerHTML = ''; done.innerHTML = '';

    const filtPri = document.getElementById('filterTaskPriority')?.value || 'all';
    const filtAss = document.getElementById('filterTaskAssignee')?.value || 'all';

    let countT = 0, countP = 0, countD = 0;

    state.tasks.forEach(t => {
        if (filtPri !== 'all' && t.priority !== filtPri) return;
        const ids = t.assigneeIds || (t.assigneeId ? [t.assigneeId] : []);
        if (filtAss !== 'all' && !ids.includes(filtAss)) return;

        const assignees = ids.map(id => state.personnel.find(p => p.id === id)).filter(Boolean);
        
        let assigneeHtml = '';
        if (assignees.length === 0) {
            assigneeHtml = '<div class="task-assignee"><span>Não Atribuído</span></div>';
        } else if (assignees.length === 1) {
            const p = assignees[0];
            const pInit = (p.warName||'?').substring(0,2).toUpperCase();
            const pAvat = p.photo
                ? `<img src="${p.photo}" style="width:20px;height:20px;border-radius:50%;object-fit:cover">`
                : `<div class="task-assignee-avatar">${pInit}</div>`;
            assigneeHtml = `<div class="task-assignee">${pAvat} <span>${p.rank} ${p.warName}</span></div>`;
        } else {
            const avatars = assignees.slice(0, 5).map(p => {
                const pInit = (p.warName||'?').substring(0,2).toUpperCase();
                return p.photo
                    ? `<img src="${p.photo}" style="width:18px;height:18px;border-radius:50%;object-fit:cover;border:1.5px solid var(--bg-secondary);margin-left:-6px">`
                    : `<div class="task-assignee-avatar" style="width:18px;height:18px;font-size:7px;border:1.5px solid var(--bg-secondary);margin-left:-6px">${pInit}</div>`;
            }).join('');
            
            const namesList = assignees.map(p => `${p.rank} ${p.warName}`).join(', ');
            
            assigneeHtml = `
                <div class="task-assignee-multi" style="width:100%">
                    <div style="display:flex;padding-left:6px;margin-bottom:4px">${avatars}</div>
                    <div style="font-size:11px; color:var(--text-secondary); line-height:1.3; font-weight:500;">${namesList}</div>
                </div>`;
        }

        const pc = PRIORITY_CFG[t.priority||'media'];

        let deadHtml = '';
        if (t.deadline) {
            const isOverdue = t.status !== 'done' && new Date(t.deadline+'T23:59:59') < new Date();
            deadHtml = `<div style="font-size:11px;margin-top:6px;color:${isOverdue?'#ef4444':'var(--text-secondary)'}">
                <i data-lucide="calendar" style="width:12px;height:12px;vertical-align:-2px"></i> ${new Date(t.deadline+'T12:00:00').toLocaleDateString('pt-BR')}
            </div>`;
        }

        const card = document.createElement('div');
        card.className = 'task-card clickable';
        card.onclick = (e) => {
            if (e.target.closest('button') || e.target.closest('select')) return;
            card.classList.toggle('expanded');
        };
        
        const canEditTask = hasPermission('manageTasks') && checkAuthorRule(t);
        const canDeleteTask = hasPermission('manageTasks') && checkAuthorRule(t);

        card.innerHTML = `
            <div class="task-actions">
                ${canEditTask ? `<button class="icon-btn" onclick="editTask('${t.id}')"><i data-lucide="edit-2" style="width:14px;height:14px"></i></button>` : ''}
                ${canDeleteTask ? `<button class="icon-btn delete" onclick="deleteTask('${t.id}')"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
                <span class="status-badge" style="color:${pc.color};background:${pc.bg}">${pc.label}</span>
            </div>
            <h4>${t.title}</h4>
            
            <div class="task-details-expandable">
                <p style="font-size:12px; color:var(--text-secondary); margin-top:8px; line-height:1.4;">
                    ${t.description ? t.description.replace(/\n/g, '<br>') : 'Sem descrição adicional.'}
                </p>
            </div>

            ${deadHtml}
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:12px;border-top:1px solid var(--border-color)">
                ${assigneeHtml}
                <select onchange="updateTaskStatus('${t.id}', this.value)" style="padding:2px 4px;font-size:11px;width:auto;min-width:0">
                    <option value="todo" ${t.status==='todo'?'selected':''}>A Fazer</option>
                    <option value="progress" ${t.status==='progress'?'selected':''}>Andamento</option>
                    <option value="done" ${t.status==='done'?'selected':''}>Concluído</option>
                </select>
            </div>`;

        if (t.status === 'todo')     { todo.appendChild(card); countT++; }
        else if (t.status === 'progress') { prog.appendChild(card); countP++; }
        else                         { done.appendChild(card); countD++; }
    });

    document.getElementById('countTodo').textContent = countT;
    document.getElementById('countProgress').textContent = countP;
    document.getElementById('countDone').textContent = countD;

    lucide.createIcons();
}

function editTask(id) {
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;
    document.getElementById('taskId').value          = t.id;
    document.getElementById('taskTitle').value       = t.title;
    document.getElementById('taskStatus').value      = t.status;
    document.getElementById('taskPriority').value    = t.priority || 'media';
    document.getElementById('taskDeadline').value    = t.deadline || '';
    document.getElementById('taskDescription').value = t.description || '';
    
    // Reset and check assignees
    const ids = t.assigneeIds || (t.assigneeId ? [t.assigneeId] : []);
    currentTaskSelectedIds = new Set(ids);
    document.getElementById('taskAssigneeSearch').value = '';
    updateAssigneeSelects(); 

    document.getElementById('taskModalTitle').textContent = 'Editar Tarefa';
    openModal('taskModal');
}

function updateTaskStatus(id, newStatus) {
    const t = state.tasks.find(x => x.id === id);
    if (t) {
        t.status = newStatus;
        saveState();
        renderTasks();
        renderDashboard();
        if (currentProfileId && document.getElementById('profileView').classList.contains('active')) {
            viewProfile(currentProfileId);
        }
    }
}

function deleteTask(id) {
    if (confirm('Excluir esta tarefa?')) {
        state.tasks = state.tasks.filter(t => t.id !== id);
        saveState();
        renderTasks();
        renderDashboard();
        if (currentProfileId && document.getElementById('profileView').classList.contains('active')) {
            viewProfile(currentProfileId);
        }
    }
}

// === OCORRÊNCIAS ===
function openOccurrenceModal(militarId) {
    document.getElementById('occurrenceForm').reset();
    document.getElementById('occId').value = '';
    document.getElementById('occMilitarId').value = militarId;
    document.getElementById('occDate').value = new Date().toISOString().split('T')[0];
    openModal('occurrenceModal');
}

function setupOccurrenceForm() {
    document.getElementById('occurrenceForm').addEventListener('submit', e => {
        e.preventDefault();
        const id = document.getElementById('occId').value;
        const occ = {
            id:          id || Date.now().toString(),
            militarId:   document.getElementById('occMilitarId').value,
            date:        document.getElementById('occDate').value,
            type:        document.getElementById('occType').value,
            description: document.getElementById('occDescription').value,
            createdBy:   id ? state.occurrences.find(o=>o.id===id).createdBy : (currentUser ? currentUser.uid : 'system'),
            createdByRole: id ? state.occurrences.find(o=>o.id===id).createdByRole : (hasPermission('isAdmin') ? 'admin' : 'operator')
        };
        if (id) {
            const idx = state.occurrences.findIndex(o => o.id === id);
            if (idx !== -1) state.occurrences[idx] = occ;
        } else {
            state.occurrences.push(occ);
        }
        closeModal('occurrenceModal');
        saveState();
        if (document.getElementById('profileView').classList.contains('active')) {
            viewProfile(occ.militarId);
        }
    });
}

function deleteOccurrence(id) {
    if (confirm('Excluir esta ocorrência?')) {
        const occ = state.occurrences.find(o => o.id === id);
        state.occurrences = state.occurrences.filter(o => o.id !== id);
        saveState();
        if (occ && currentProfileId === occ.militarId && document.getElementById('profileView').classList.contains('active')) {
            viewProfile(occ.militarId);
        }
    }
}

// === QUICK SEARCH ===
let selectedSearchIndex = -1;

function setupQuickSearch() {
    const modal = document.getElementById('quickSearchModal');
    const input = document.getElementById('globalSearchInput');
    const results = document.getElementById('globalSearchResults');
    const btn = document.getElementById('btnQuickSearch');

    if (btn) btn.addEventListener('click', () => openQuickSearch());

    window.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            openQuickSearch();
        }
        if (e.key === 'Escape') closeModal('quickSearchModal');
    });

    input.addEventListener('input', () => {
        const query = input.value.toLowerCase();
        if (!query) {
            results.innerHTML = '';
            selectedSearchIndex = -1;
            return;
        }

        const filtered = state.personnel.filter(m => 
            (m.warName + m.fullName + m.rank + m.section).toLowerCase().includes(query)
        ).slice(0, 8);

        renderSearchResults(filtered);
    });

    input.addEventListener('keydown', e => {
        const items = results.querySelectorAll('.search-result-item');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedSearchIndex = Math.min(selectedSearchIndex + 1, items.length - 1);
            updateSearchSelection(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedSearchIndex = Math.max(selectedSearchIndex - 1, 0);
            updateSearchSelection(items);
        } else if (e.key === 'Enter' && selectedSearchIndex >= 0) {
            items[selectedSearchIndex].click();
        }
    });
}

function openQuickSearch() {
    const input = document.getElementById('globalSearchInput');
    input.value = '';
    document.getElementById('globalSearchResults').innerHTML = '';
    selectedSearchIndex = -1;
    openModal('quickSearchModal');
    setTimeout(() => input.focus(), 100);
}

function renderSearchResults(list) {
    const results = document.getElementById('globalSearchResults');
    if (list.length === 0) {
        results.innerHTML = '<p style="padding:12px;color:var(--text-secondary);font-size:14px">Nenhum resultado encontrado.</p>';
        return;
    }

    results.innerHTML = list.map((m, idx) => `
        <div class="search-result-item" onclick="selectSearchResult('${m.id}')" 
             style="padding:12px;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:12px;margin-bottom:4px;transition:all 0.2s">
            <div class="escala-avatar" style="width:32px;height:32px;flex-shrink:0">
                ${m.photo ? `<img src="${m.photo}" class="escala-avatar-img">` : (m.warName||'?').substring(0,2).toUpperCase()}
            </div>
            <div>
                <div style="font-weight:600;font-size:14px">${m.rank} ${m.warName}</div>
                <div style="font-size:12px;color:var(--text-secondary)">${m.section} · ${m.function}</div>
            </div>
        </div>
    `).join('');
    selectedSearchIndex = 0;
    updateSearchSelection(results.querySelectorAll('.search-result-item'));
}

function updateSearchSelection(items) {
    items.forEach((item, idx) => {
        if (idx === selectedSearchIndex) {
            item.style.background = 'var(--bg-tertiary)';
            item.style.boxShadow = 'inset 0 0 0 1px var(--accent-color)';
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.style.background = 'transparent';
            item.style.boxShadow = 'none';
        }
    });
}

function selectSearchResult(id) {
    closeModal('quickSearchModal');
    viewProfile(id);
}

// === INFORMATIVO (Mural e Calendário) ===
let currentCalDate = new Date();

function renderInformativo() {
    renderNotices();
    renderCalendar();
    setupInformativoEvents();
}

function renderNotices() {
    const grid = document.getElementById('noticesGrid');
    if (!grid) return;

    if (state.notices.length === 0) {
        grid.innerHTML = '<p style="grid-column:1/-1;color:var(--text-secondary);text-align:center;padding:20px;">Nenhum aviso no mural.</p>';
        return;
    }

    grid.innerHTML = state.notices.sort((a,b) => new Date(b.date) - new Date(a.date)).map(n => `
        <div class="notice-card">
            <button class="icon-btn delete" onclick="deleteNotice('${n.id}')" style="position:absolute;top:8px;right:8px">
                <i data-lucide="trash-2" style="width:14px;height:14px"></i>
            </button>
            <h4>${n.title}</h4>
            <p>${n.content}</p>
            <span class="notice-date">${new Date(n.date).toLocaleDateString('pt-BR')}</span>
        </div>
    `).join('');
    lucide.createIcons();
}

function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    const title = document.getElementById('calendarTitle');
    if (!grid || !title) return;

    const year = currentCalDate.getFullYear();
    const month = currentCalDate.getMonth();
    const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(currentCalDate);
    title.textContent = `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${year}`;

    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const lastDayPrevMonth = new Date(year, month, 0).getDate();

    let html = '';

    // Dias do mês anterior
    for (let i = firstDay; i > 0; i--) {
        html += `<div class="calendar-day other-month"><span class="day-number">${lastDayPrevMonth - i + 1}</span></div>`;
    }

    // Dias do mês atual
    const today = new Date();
    for (let d = 1; d <= lastDate; d++) {
        const isToday = today.getDate() === d && today.getMonth() === month && today.getFullYear() === year;
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dayEvents = state.calendarEvents.filter(e => e.date === dateStr);

        html += `
            <div class="calendar-day ${isToday ? 'today' : ''}" onclick="openDayDetails('${dateStr}')">
                <span class="day-number">${d}</span>
                <div class="day-events">
                    ${dayEvents.map(e => {
                        const catColor = {
                            'info': '#3b82f6',
                            'instrucao': '#10b981',
                            'formatura': '#f59e0b',
                            'prazo': '#ef4444',
                            'outro': '#64748b'
                        }[e.category || 'info'];
                        return `<div class="event-item" title="${e.description || e.title}" style="border-left: 3px solid ${catColor}">${e.title}</div>`;
                    }).join('')}
                </div>
            </div>`;
    }

    grid.innerHTML = html;
}

function setupInformativoEvents() {
    const btnAdd = document.getElementById('btnAddNotice');
    if (btnAdd && !btnAdd.onclick) {
        btnAdd.onclick = () => {
            const title = prompt('Título do Aviso:');
            const content = prompt('Conteúdo:');
            if (title && content) {
                state.notices.push({
                    id: Date.now().toString(),
                    title,
                    content,
                    date: new Date().toISOString()
                });
                saveState();
                renderNotices();
            }
        };
    }

    const prev = document.getElementById('prevMonth');
    const next = document.getElementById('nextMonth');
    const today = document.getElementById('btnToday');

    if (prev && !prev.onclick) prev.onclick = () => { currentCalDate.setMonth(currentCalDate.getMonth() - 1); renderCalendar(); };
    if (next && !next.onclick) next.onclick = () => { currentCalDate.setMonth(currentCalDate.getMonth() + 1); renderCalendar(); };
    if (today && !today.onclick) today.onclick = () => { currentCalDate = new Date(); renderCalendar(); };
}

function deleteNotice(id) {
    if (confirm('Excluir este aviso?')) {
        state.notices = state.notices.filter(n => n.id !== id);
        saveState();
        renderNotices();
    }
}

function addEventPrompt(dateStr) {
    // Mantendo por compatibilidade se necessário, mas redirecionando
    openDayDetails(dateStr);
}

function openDayDetails(dateStr) {
    const title = document.getElementById('calModalTitle');
    const list = document.getElementById('dayEventsList');
    const input = document.getElementById('newCalEventTitle');
    const hiddenDate = document.getElementById('calModalDate');
    
    const dateObj = new Date(dateStr + 'T12:00:00');
    title.textContent = dateObj.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
    hiddenDate.value = dateStr;
    input.value = '';
    
    renderDayEventsList(dateStr);
    openModal('calendarDayModal');
}

function renderDayEventsList(dateStr) {
    const list = document.getElementById('dayEventsList');
    const dayEvents = state.calendarEvents.filter(e => e.date === dateStr);
    
    if (dayEvents.length === 0) {
        list.innerHTML = '<p style="color:var(--text-secondary);font-size:13px">Nenhum evento para este dia.</p>';
        return;
    }
    
    list.innerHTML = dayEvents.map(e => {
        const catLabel = {
            'info': 'Informação',
            'instrucao': 'Instrução',
            'formatura': 'Formatura',
            'prazo': 'Prazo',
            'outro': 'Outro'
        }[e.category || 'info'];
        
        return `
            <div style="background:var(--bg-tertiary);padding:12px;border-radius:8px;font-size:13px;border:1px solid var(--border-color);">
                <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px;">
                    <strong style="color:var(--text-primary)">${e.title}</strong>
                    <button class="icon-btn delete" onclick="deleteCalendarEvent('${e.id}', '${dateStr}')">
                        <i data-lucide="trash-2" style="width:14px;height:14px"></i>
                    </button>
                </div>
                <div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">${catLabel}</div>
                ${e.description ? `<p style="margin:0;color:var(--text-secondary);font-size:12px;white-space:pre-wrap;">${e.description}</p>` : ''}
            </div>
        `;
    }).join('');
    lucide.createIcons();
}

function deleteCalendarEvent(id, dateStr) {
    state.calendarEvents = state.calendarEvents.filter(e => e.id !== id);
    saveState();
    renderCalendar();
    renderDayEventsList(dateStr);
}

// === TABS ===
function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => {
            const view = btn.closest('.view');
            view.querySelectorAll('.tab-btn').forEach(b => {
                b.classList.remove('active');
                b.style.borderBottomColor = 'transparent';
                b.style.color = 'var(--text-secondary)';
            });
            view.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
            
            btn.classList.add('active');
            btn.style.borderBottomColor = 'var(--accent-color)';
            btn.style.color = 'var(--accent-color)';
            document.getElementById(btn.dataset.tab).style.display = 'block';
        };
    });
}

// === MISSÕES ===

function checkExpiredMissions() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let changed = false;

    // Pass 1: Check expired missions and reset their personnel
    state.missions.forEach(mission => {
        if (!mission.endDate) return;
        const endDate = new Date(mission.endDate + 'T23:59:59');
        if (endDate < today && mission.status !== 'concluida') {
            mission.status = 'concluida';
            mission.personnelIds.forEach(pId => {
                const p = state.personnel.find(x => x.id === pId);
                if (p && p.status === 'missao') {
                    p.status = 'disponivel';
                    p.statusReason = '';
                    p.statusReturnDate = null;
                    changed = true;
                }
            });
        }
    });

    // Pass 2: Clean stale reason/returnDate from anyone already 'disponivel'
    state.personnel.forEach(p => {
        const st = p.status || 'disponivel';
        if (st === 'disponivel' && (p.statusReason || p.statusReturnDate)) {
            p.statusReason = '';
            p.statusReturnDate = null;
            changed = true;
        }
    });

    if (changed) saveState();
}

function emergencyWipeMissions() {
    if (!confirm('ATENÇÃO: Isso vai apagar TODAS as missões e resetar o status de todos os militares para Disponível. Tem certeza?')) return;
    
    state.missions = [];
    state.personnel.forEach(p => {
        // Fix any weirdly capitalized statuses from imports
        if (p.status) p.status = p.status.toLowerCase().trim();
        
        const st = p.status || 'disponivel';
        // Aggressively clean up ANY status that isn't specifically an active absence
        if (!['ferias', 'licenca', 'afastado', 'servico'].includes(st)) {
            p.status = 'disponivel';
            p.statusReason = '';
            p.statusReturnDate = null;
        }
    });
    
    saveState();
    alert('Limpeza concluída! A página será recarregada.');
    window.location.reload(true);
}

function concludeMission(id) {
    if (!confirm('Registrar o retorno desta missão? Todos os militares voltarão para Disponível.')) return;
    const mission = state.missions.find(m => m.id === id);
    if (mission) {
        mission.personnelIds.forEach(pId => {
            const p = state.personnel.find(x => x.id === pId);
            if (p && p.status === 'missao') {
                p.status = 'disponivel';
                p.statusReason = '';
                p.statusReturnDate = null;
                recordStatusHistory(pId, 'missao', 'disponivel', 'Retorno de missão');
            }
        });
        mission.status = 'concluida';
        saveState();
        renderMissions();
        renderDashboard();
        renderPersonnelList();
        renderEscala();
    }
}

function renderMissions() {
    const grid = document.getElementById('missionsList');
    if (!grid) return;

    const searchQuery = (document.getElementById('searchMissions')?.value || '').toLowerCase();

    const filteredMissions = state.missions.filter(m => {
        if (!searchQuery) return true;
        const personnelNames = m.personnelIds.map(id => {
            const p = state.personnel.find(x => x.id === id);
            return p ? (p.rank + ' ' + p.warName).toLowerCase() : '';
        }).join(' ');
        return m.reason.toLowerCase().includes(searchQuery) || 
               (m.notes || '').toLowerCase().includes(searchQuery) ||
               personnelNames.includes(searchQuery);
    });

    if (state.missions.length === 0) {
        grid.innerHTML = '<p style="grid-column:1/-1;color:var(--text-secondary);text-align:center;padding:40px;background:var(--bg-tertiary);border-radius:12px;border:1px dashed var(--border-color);">Nenhuma missão registrada no sistema.</p>';
        return;
    }

    if (filteredMissions.length === 0 && searchQuery) {
        grid.innerHTML = '<p style="grid-column:1/-1;color:var(--text-secondary);text-align:center;padding:40px;">Nenhuma missão encontrada para "<strong>' + searchQuery + '</strong>".</p>';
        return;
    }

    const activeMissions = filteredMissions.filter(m => m.status !== 'concluida').sort((a,b) => new Date(b.startDate) - new Date(a.startDate));
    const completedMissions = filteredMissions.filter(m => m.status === 'concluida').sort((a,b) => new Date(b.startDate) - new Date(a.startDate));

    const renderCard = (m, isActive) => {
        const personnel = m.personnelIds.map(id => {
            const p = state.personnel.find(x => x.id === id);
            return p ? `<span onclick="event.stopPropagation(); viewProfile('${p.id}')" style="cursor:pointer; color:var(--accent-color); font-weight:600; text-decoration:none; border-bottom:1px solid transparent;" onmouseover="this.style.borderBottom='1px solid var(--accent-color)'" onmouseout="this.style.borderBottom='1px solid transparent'">${p.rank} ${p.warName}</span>` : 'Desconhecido';
        }).join(', ');

        const buttons = isActive ? `
            <button class="btn-icon" onclick="event.stopPropagation(); concludeMission('${m.id}')" title="Registrar Retorno" style="color:#10b981">
                <i data-lucide="log-out"></i>
            </button>
            <button class="btn-icon" onclick="event.stopPropagation(); editMission('${m.id}')" title="Editar Missão">
                <i data-lucide="edit-2"></i>
            </button>
            <button class="btn-icon delete" onclick="event.stopPropagation(); deleteMission('${m.id}')">
                <i data-lucide="trash-2"></i>
            </button>
        ` : `
            <span class="status-badge" style="background:rgba(16,185,129,0.1); color:#10b981; margin-right:8px; border:1px solid rgba(16,185,129,0.2);">Concluída</span>
            <button class="btn-icon" onclick="event.stopPropagation(); reactivateMission('${m.id}')" title="Reativar Missão" style="color:var(--accent-color)">
                <i data-lucide="refresh-cw"></i>
            </button>
            <button class="btn-icon delete" onclick="event.stopPropagation(); deleteMission('${m.id}')">
                <i data-lucide="trash-2"></i>
            </button>
        `;

        return `
            <div class="mission-card ${isActive ? '' : 'completed'}" onclick="this.classList.toggle('expanded')">
                <div style="display:flex; justify-content:space-between; align-items:start;">
                    <h4 style="color:${isActive ? 'var(--text-primary)' : 'var(--text-secondary)'};">${m.reason}</h4>
                    <div style="display:flex; gap:8px; align-items:center;">
                        ${buttons}
                    </div>
                </div>
                <div class="mission-mil-list">
                    <strong style="color:var(--text-secondary); font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Efetivo:</strong><br>
                    ${personnel}
                </div>
                <div class="mission-dates">
                    <div><i data-lucide="calendar"></i> Partida: ${formatDateBR(m.startDate)}</div>
                    <div><i data-lucide="arrow-right-circle"></i> Retorno: ${formatDateBR(m.endDate)}</div>
                </div>
                <div class="mission-details-expand">
                    <p style="font-size:11px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:1px; margin-bottom:8px; font-weight:700;">Observações Detalhadas</p>
                    <div style="padding:12px; background:var(--bg-primary); border-radius:8px; font-size:13px; color:var(--text-primary); border:1px solid var(--border-color);">
                        ${m.notes || 'Nenhuma observação registrada para esta missão.'}
                    </div>
                    <div style="text-align:center; margin-top:16px;">
                        <i data-lucide="chevron-up" style="width:16px; height:16px; color:var(--text-secondary); opacity:0.5"></i>
                    </div>
                </div>
                <div class="mission-expand-hint" style="text-align:center; margin-top:8px;">
                    <i data-lucide="chevron-down" style="width:16px; height:16px; color:var(--text-secondary); opacity:0.5"></i>
                </div>
            </div>
        `;
    };

    let html = '';
    
    if (activeMissions.length > 0) {
        html += activeMissions.map(m => renderCard(m, true)).join('');
    } else if (!searchQuery) {
        html += '<p style="grid-column:1/-1;color:var(--text-secondary);text-align:center;padding:40px;background:rgba(0,0,0,0.02);border-radius:12px;">Nenhuma missão ativa no momento.</p>';
    }

    if (completedMissions.length > 0) {
        html += `
            <div class="mission-history-title">
                <i data-lucide="history"></i>
                <h3>Histórico de Missões</h3>
            </div>
        `;
        html += completedMissions.map(m => renderCard(m, false)).join('');
    }

    grid.innerHTML = html;
    lucide.createIcons();
}

function setupMissionForm() {
    const btnNew = document.getElementById('btnNewMission');
    const searchInput = document.getElementById('searchPersonnelMission');
    const searchMissionInput = document.getElementById('searchMissions');

    if (searchMissionInput) {
        searchMissionInput.addEventListener('input', renderMissions);
    }

    if (btnNew) {
        btnNew.onclick = () => {
            document.getElementById('missionForm').reset();
            document.getElementById('missionId').value = '';
            document.getElementById('missionModalTitle').textContent = 'Nova Missão';
            if (searchInput) searchInput.value = '';
            
            // Popular lista de militares com checkboxes
            const list = document.getElementById('missionPersonnelList');
            list.innerHTML = state.personnel.sort((a,b) => getRankWeight(a.rank) - getRankWeight(b.rank)).map(m => `
                <div class="mission-mil-row" data-search="${(m.rank + ' ' + m.warName).toLowerCase()}" style="display:flex; align-items:center; gap:8px; padding:4px 0;">
                    <input type="checkbox" name="missionMils" value="${m.id}" id="chk_${m.id}">
                    <label for="chk_${m.id}" style="font-size:13px; cursor:pointer;">${m.rank} ${m.warName}</label>
                </div>
            `).join('');
            
            openModal('missionModal');
        };
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const query = searchInput.value.toLowerCase();
            document.querySelectorAll('.mission-mil-row').forEach(row => {
                const text = row.dataset.search;
                row.style.display = text.includes(query) ? 'flex' : 'none';
            });
        });
    }

    document.getElementById('missionForm').addEventListener('submit', e => {
        e.preventDefault();
        const missionId = document.getElementById('missionId').value;
        const selectedMils = Array.from(document.querySelectorAll('input[name="missionMils"]:checked')).map(cb => cb.value);
        
        if (selectedMils.length === 0) {
            alert('Selecione pelo menos um militar.');
            return;
        }

        const isPast = document.getElementById('missionEndDate').value 
            ? new Date(document.getElementById('missionEndDate').value + 'T23:59:59') < new Date() 
            : false;

        const mission = {
            id: missionId || Date.now().toString(),
            personnelIds: selectedMils,
            startDate: document.getElementById('missionStartDate').value,
            endDate: document.getElementById('missionEndDate').value,
            reason: document.getElementById('missionReason').value,
            notes: document.getElementById('missionNotes').value,
            status: missionId ? (state.missions.find(m => m.id === missionId)?.status || 'ativa') : (isPast ? 'concluida' : 'ativa')
        };

        if (missionId) {
            // Reverter status dos militares que estavam na missão anteriormente se a missão não estava concluída
            const oldMission = state.missions.find(m => m.id === missionId);
            if (oldMission && oldMission.status !== 'concluida') {
                oldMission.personnelIds.forEach(id => {
                    const p = state.personnel.find(x => x.id === id);
                    if (p && p.status === 'missao') {
                        p.status = 'disponivel';
                        p.statusReason = '';
                        p.statusReturnDate = null;
                    }
                });
            }
            const idx = state.missions.findIndex(m => m.id === missionId);
            state.missions[idx] = mission;
        } else {
            state.missions.push(mission);
        }

        // Atualizar status dos militares selecionados apenas se a missão não for passada/concluída
        if (mission.status !== 'concluida') {
            selectedMils.forEach(id => {
                const p = state.personnel.find(x => x.id === id);
                if (p) {
                    const oldStatus = p.status || 'disponivel';
                    p.status = 'missao';
                    p.statusReason = mission.reason;
                    p.statusReturnDate = mission.endDate;
                    
                    recordStatusHistory(id, oldStatus, 'missao', 'Missão: ' + mission.reason);
                }
            });
        }

        closeModal('missionModal');
        saveState();
        renderMissions();
    });
}

function editMission(id) {
    const m = state.missions.find(x => x.id === id);
    if (!m) return;

    document.getElementById('missionId').value = m.id;
    document.getElementById('missionModalTitle').textContent = 'Editar Missão';
    document.getElementById('missionStartDate').value = m.startDate;
    document.getElementById('missionEndDate').value = m.endDate;
    document.getElementById('missionReason').value = m.reason;
    document.getElementById('missionNotes').value = m.notes;

    const list = document.getElementById('missionPersonnelList');
    list.innerHTML = state.personnel.sort((a,b) => getRankWeight(a.rank) - getRankWeight(b.rank)).map(p => `
        <div class="mission-mil-row" data-search="${(p.rank + ' ' + p.warName).toLowerCase()}" style="display:flex; align-items:center; gap:8px; padding:4px 0;">
            <input type="checkbox" name="missionMils" value="${p.id}" id="chk_${p.id}" ${m.personnelIds.includes(p.id) ? 'checked' : ''}>
            <label for="chk_${p.id}" style="font-size:13px; cursor:pointer;">${p.rank} ${p.warName}</label>
        </div>
    `).join('');

    openModal('missionModal');
}

function deleteMission(id) {
    if (confirm('Excluir esta missão?')) {
        const mission = state.missions.find(m => m.id === id);
        if (mission) {
            mission.personnelIds.forEach(pId => {
                const p = state.personnel.find(x => x.id === pId);
                if (p && p.status === 'missao') {
                    p.status = 'disponivel';
                    p.statusReason = '';
                    p.statusReturnDate = null;
                }
            });
        }
        state.missions = state.missions.filter(m => m.id !== id);
        saveState();
        renderMissions();
        renderDashboard();
    }
}

function reactivateMission(id) {
    if (!confirm('Reativar esta missão? Os militares selecionados voltarão ao status "Em Missão".')) return;
    const mission = state.missions.find(m => m.id === id);
    if (mission) {
        mission.status = 'ativa';
        mission.personnelIds.forEach(pId => {
            const p = state.personnel.find(x => x.id === pId);
            if (p) {
                const oldStatus = p.status || 'disponivel';
                p.status = 'missao';
                p.statusReason = mission.reason;
                p.statusReturnDate = mission.endDate;
                recordStatusHistory(pId, oldStatus, 'missao', 'Reativação de missão: ' + mission.reason);
            }
        });
        saveState();
        renderMissions();
        renderDashboard();
        renderPersonnelList();
    }
}

const SERVICE_POSTS = [
    "Of Dia", "Adj Of Dia", "Enfermeiro Dia", "Sgt Dia Esqd C Ap", "Sgt Ala Oeste", 
    "Cmt Gda", "Cb da Gda", "Cb Gda Pcp", "Cb Dia 1º Esqd", "Cb Dia 2º Esqd", "Cb Dia 3º Esqd", 
    "Cb Dia Esqd C Ap", "Portão Sul", "Gda Res Cmt", "Gda Interna", "Gda Externa", 
    "Faxina Pavilhão", "Padioleiro Dia", "Motorista Amb", "Motorista de Dia"
];

function renderServicePostsInputs() {
    const container = document.getElementById('servicePostsList');
    if (!container) return;

    // Filtro global: Militares disponíveis + Exclusões específicas
    const available = state.personnel.filter(p => {
        const isDisponivel = p.status === 'disponivel' || !p.status;
        const name = (p.warName || '').toLowerCase();
        const rank = p.rank;
        const section = p.section;
        const func = (p.function || '').toLowerCase();
        
        // Exclusões por Função
        if (func.includes('ordenança') || func.includes('armeiro')) return false;
        if (func.includes('dentista') || func.includes('médico')) return false;
        
        // Exclusões por Nome/Posto
        if (rank === 'Sd' && (name.includes('j pereira') || name.includes('virgílio'))) return false;
        if (rank === 'Cb' && (name.includes('oviedo') || name.includes('ramos'))) return false;
        if (rank === 'Cap' && name.includes('blanco')) return false;
        if (rank.includes('Ten') && name.includes('romney')) return false;
        if (name.includes('isaque') || name.includes('geisler')) return false;
        
        // Exclusões por Seção/Posto
        if (section === 'Pelotão de Aprovisionamento') return false;
        if (rank === 'Sd' && section === 'CIMPORÃ') return false;
        
        return isDisponivel;
    }).sort((a,b) => getRankWeight(a.rank) - getRankWeight(b.rank));

    container.innerHTML = SERVICE_POSTS.map((post, index) => {
        const selectedIds = tempAssignments[post] || [];
        const countText = selectedIds.length > 0 ? ` (${selectedIds.length})` : '';
        const btnClass = selectedIds.length > 0 ? 'btn-primary' : 'btn-outline';

        return `
            <div class="form-group" style="margin-bottom:0;">
                <button type="button" class="btn ${btnClass}" style="width:100%; justify-content:space-between; font-size:12px; height:auto; padding:10px;" onclick="openPostSelection('${post}', ${index})">
                    <span>${post}${countText}</span>
                    <i data-lucide="chevron-right" style="width:14px; height:14px;"></i>
                </button>
            </div>
        `;
    }).join('');
    lucide.createIcons();
}

let tempAssignments = {}; // { postName: [ids] }
let tempOtherActivities = []; // [ { id, name, observation, personnelIds: [] } ]
let currentPostSelection = null;
let currentActivitySelectionId = null;

function openPostSelection(post, index) {
    currentPostSelection = post;
    const modalTitle = document.getElementById('servicePersonnelModalTitle');
    modalTitle.textContent = `Selecionar para: ${post}`;
    
    renderServicePersonnelSelectionList(post);
    openModal('servicePersonnelModal');
}

function renderServicePersonnelSelectionList(post) {
    const container = document.getElementById('servicePersonnelSelectionList');
    const search = document.getElementById('searchServicePersonnel').value.toLowerCase();
    
    const pool = getFilteredPoolForPost(post);
    const selectedIds = tempAssignments[post] || [];

    const filtered = pool.filter(p => 
        (p.rank + ' ' + p.warName).toLowerCase().includes(search)
    );

    container.innerHTML = filtered.map(m => `
        <div style="display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid var(--border-color);">
            <input type="checkbox" id="sel_${m.id}" value="${m.id}" ${selectedIds.includes(m.id) ? 'checked' : ''} onchange="togglePostAssignment('${post}', '${m.id}', this.checked)">
            <label for="sel_${m.id}" style="font-size:13px; cursor:pointer; flex:1;">${m.rank} ${m.warName} <small style="color:var(--text-secondary)">(${m.section})</small></label>
        </div>
    `).join('');

    if (post === "Motorista Amb") {
        const isExtSelected = selectedIds.includes('ext_rhickelmi');
        container.innerHTML += `
            <div style="display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid var(--border-color);">
                <input type="checkbox" id="sel_ext" value="ext_rhickelmi" ${isExtSelected ? 'checked' : ''} onchange="togglePostAssignment('${post}', 'ext_rhickelmi', this.checked)">
                <label for="sel_ext" style="font-size:13px; cursor:pointer; flex:1;">Cb RHICKELMI (Externo)</label>
            </div>
        `;
    }

    if (filtered.length === 0 && post !== "Motorista Amb") {
        container.innerHTML = '<p style="text-align:center; padding:20px; color:var(--text-secondary);">Nenhum militar disponível encontrado.</p>';
    }
}

function togglePostAssignment(post, id, checked) {
    if (!tempAssignments[post]) tempAssignments[post] = [];
    if (checked) {
        if (!tempAssignments[post].includes(id)) tempAssignments[post].push(id);
    } else {
        tempAssignments[post] = tempAssignments[post].filter(x => x !== id);
    }
    renderServicePostsInputs();
}

function getFilteredPoolForPost(post) {
    const ofList = ['Cel', 'Ten Cel', 'Maj', 'Cap', '1º Ten', '2º Ten', 'Asp'];
    const nurseList = ['karine cruz', 'danna'];

    const available = state.personnel.filter(p => {
        const isDisponivel = p.status === 'disponivel' || !p.status;
        const name = (p.warName || '').toLowerCase();
        const rank = p.rank;
        const section = p.section;
        if (section === "Adidos/Encostados/Reintegrados") return false;
        const func = (p.function || '').toLowerCase();
        if (func.includes('ordenança') || func.includes('armeiro')) return false;
        if (func.includes('dentista') || func.includes('médico')) return false;
        if (rank === 'Sd' && (name.includes('j pereira') || name.includes('virgílio'))) return false;
        if (rank === 'Cb' && (name.includes('oviedo') || name.includes('ramos'))) return false;
        if (rank === 'Cap' && name.includes('blanco')) return false;
        if (rank.includes('Ten') && name.includes('romney')) return false;
        if (name.includes('isaque') || name.includes('geisler')) return false;
        if (section === 'Pelotão de Aprovisionamento') return false;
        if (rank === 'Sd' && section === 'CIMPORÃ') return false;
        return isDisponivel;
    });

    let pool = available;
    if (post !== "Enfermeiro Dia") {
        pool = pool.filter(p => !nurseList.some(name => p.warName.toLowerCase().includes(name)));
    }

    switch(post) {
        case "Of Dia": return pool.filter(p => ofList.includes(p.rank));
        case "Adj Of Dia": return pool.filter(p => ['2º Ten', 'Asp', '1º Sgt', '2º Sgt'].includes(p.rank));
        case "Sgt Dia Esqd C Ap":
        case "Sgt Ala Oeste":
        case "Cmt Gda": return pool.filter(p => p.rank === '3º Sgt');
        case "Cb da Gda":
        case "Cb Gda Pcp":
        case "Cb Dia 1º Esqd":
        case "Cb Dia 2º Esqd":
        case "Cb Dia 3º Esqd":
        case "Cb Dia Esqd C Ap": return pool.filter(p => p.rank === 'Cb');
        case "Portão Sul": return pool.filter(p => ['Cb', 'Sd'].includes(p.rank));
        case "Gda Res Cmt":
        case "Gda Interna":
        case "Gda Externa":
        case "Faxina Pavilhão": return pool.filter(p => p.rank === 'Sd');
        case "Enfermeiro Dia": return pool.filter(p => p.rank.includes('Sgt') && nurseList.some(name => p.warName.toLowerCase().includes(name)));
        case "Padioleiro Dia": return pool.filter(p => ['Cb', 'Sd'].includes(p.rank) && p.section === 'Pelotão de Saúde');
        case "Motorista Amb": return pool.filter(p => (p.rank === 'Cb' && (p.warName.toLowerCase().includes('diogo') || p.warName.toLowerCase().includes('emerson'))) || (p.rank === 'Sd' && p.warName.toLowerCase().includes('roberto')));
        case "Motorista de Dia": return pool.filter(p => p.rank === 'Sd' && (p.warName.toLowerCase().includes('bruno centurião') || p.warName.toLowerCase().includes('ricardo')));
        default: return pool;
    }
}

function renderOtherActivitiesInputs() {
    const container = document.getElementById('otherActivitiesList');
    if (!container) return;

    if (tempOtherActivities.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--text-secondary); font-size:13px; padding:12px; background:var(--bg-tertiary); border-radius:8px; border:1px dashed var(--border-color);">Nenhuma atividade extra adicionada.</p>';
        return;
    }

    container.innerHTML = tempOtherActivities.map((act, index) => {
        const countText = act.personnelIds.length > 0 ? ` (${act.personnelIds.length})` : '';
        const btnClass = act.personnelIds.length > 0 ? 'btn-primary' : 'btn-outline';

        return `
            <div class="activity-item" style="background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:16px;">
                <div style="display:grid; grid-template-columns: 1fr 1fr auto; gap:12px; align-items: end;">
                    <div class="form-group" style="margin:0;">
                        <label style="font-size:11px;">Nome da Atividade</label>
                        <input type="text" value="${act.name}" oninput="updateActivityData('${act.id}', 'name', this.value)" placeholder="Ex: Faxina, Instrução...">
                    </div>
                    <div class="form-group" style="margin:0;">
                        <label style="font-size:11px;">Observação</label>
                        <input type="text" value="${act.observation}" oninput="updateActivityData('${act.id}', 'observation', this.value)" placeholder="Ex: Pavilhão central...">
                    </div>
                    <button type="button" class="btn btn-icon delete" onclick="removeOtherActivity('${act.id}')" title="Remover Atividade">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
                <div style="margin-top:12px;">
                    <button type="button" class="btn ${btnClass} btn-sm" style="width:100%; justify-content:space-between;" onclick="openActivitySelection('${act.id}')">
                        <span><i data-lucide="users" style="width:14px; height:14px; vertical-align:middle; margin-right:4px;"></i> Militares Escalados${countText}</span>
                        <i data-lucide="chevron-right" style="width:14px; height:14px;"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
    lucide.createIcons();
}

function updateActivityData(id, field, value) {
    const act = tempOtherActivities.find(a => a.id === id);
    if (act) act[field] = value;
}

function removeOtherActivity(id) {
    tempOtherActivities = tempOtherActivities.filter(a => a.id !== id);
    renderOtherActivitiesInputs();
}

function openActivitySelection(id) {
    currentActivitySelectionId = id;
    currentPostSelection = null;
    const act = tempOtherActivities.find(a => a.id === id);
    const modalTitle = document.getElementById('servicePersonnelModalTitle');
    modalTitle.textContent = `Selecionar para: ${act.name || 'Atividade'}`;
    
    renderActivityPersonnelSelectionList(id);
    openModal('servicePersonnelModal');
}

function renderActivityPersonnelSelectionList(activityId) {
    const container = document.getElementById('servicePersonnelSelectionList');
    const search = document.getElementById('searchServicePersonnel').value.toLowerCase();
    
    const pool = state.personnel.filter(p => p.status === 'disponivel' || !p.status)
                  .sort((a,b) => getRankWeight(a.rank) - getRankWeight(b.rank));
                  
    const act = tempOtherActivities.find(a => a.id === activityId);
    const selectedIds = act ? act.personnelIds : [];

    const filtered = pool.filter(p => 
        (p.rank + ' ' + p.warName).toLowerCase().includes(search)
    );

    container.innerHTML = filtered.map(m => `
        <div style="display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid var(--border-color);">
            <input type="checkbox" id="sel_act_${m.id}" value="${m.id}" ${selectedIds.includes(m.id) ? 'checked' : ''} onchange="toggleActivityAssignment('${activityId}', '${m.id}', this.checked)">
            <label for="sel_act_${m.id}" style="font-size:13px; cursor:pointer; flex:1;">${m.rank} ${m.warName} <small style="color:var(--text-secondary)">(${m.section})</small></label>
        </div>
    `).join('');

    if (filtered.length === 0) {
        container.innerHTML = '<p style="text-align:center; padding:20px; color:var(--text-secondary);">Nenhum militar disponível encontrado.</p>';
    }
}

function toggleActivityAssignment(activityId, milId, checked) {
    const act = tempOtherActivities.find(a => a.id === activityId);
    if (!act) return;
    
    if (checked) {
        if (!act.personnelIds.includes(milId)) act.personnelIds.push(milId);
    } else {
        act.personnelIds = act.personnelIds.filter(x => x !== milId);
    }
    renderOtherActivitiesInputs();
}

function setupServiceForm() {
    const btnNew = document.getElementById('btnNewServiceRoster');
    const searchPersonnelInput = document.getElementById('searchServicePersonnel');

    if (btnNew) {
        btnNew.onclick = () => {
            document.getElementById('serviceForm').reset();
            document.getElementById('serviceId').value = '';
            document.getElementById('serviceModalTitle').textContent = 'Lançar Militares de Serviço';
            document.getElementById('serviceDate').value = new Date().toISOString().split('T')[0];
            tempAssignments = {};
            tempOtherActivities = [];
            renderServicePostsInputs();
            renderOtherActivitiesInputs();
            openModal('serviceModal');
        };
    }

    if (searchPersonnelInput) {
        searchPersonnelInput.oninput = () => {
            if (currentPostSelection) {
                renderServicePersonnelSelectionList(currentPostSelection);
            } else if (currentActivitySelectionId) {
                renderActivityPersonnelSelectionList(currentActivitySelectionId);
            }
        };
    }

    document.getElementById('serviceForm').addEventListener('submit', e => {
        e.preventDefault();
        const serviceId = document.getElementById('serviceId').value;
        const assignments = [];
        const selectedMils = [];
        
        Object.entries(tempAssignments).forEach(([post, ids]) => {
            ids.forEach(id => {
                assignments.push({ post, personnelId: id });
                selectedMils.push(id);
            });
        });
        
        if (assignments.length === 0) {
            alert('Selecione pelo menos um militar para o serviço.');
            return;
        }

        const roster = {
            id: serviceId || Date.now().toString(),
            date: document.getElementById('serviceDate').value,
            assignments: assignments,
            otherActivities: tempOtherActivities
        };

        if (serviceId) {
            // Reverter status dos militares que estavam no serviço anteriormente
            const oldRoster = state.serviceRosters.find(r => r.id === serviceId);
            if (oldRoster) {
                oldRoster.assignments.forEach(a => {
                    if (a.personnelId.startsWith('ext_')) return;
                    const p = state.personnel.find(x => x.id === a.personnelId);
                    if (p && p.status === 'servico') {
                        p.status = 'disponivel';
                        p.statusReason = '';
                        p.statusReturnDate = null;
                    }
                });
            }
            const idx = state.serviceRosters.findIndex(r => r.id === serviceId);
            state.serviceRosters[idx] = roster;
        } else {
            state.serviceRosters.push(roster);
        }

        // Atualizar status para 'servico'
        selectedMils.forEach(id => {
            if (id.startsWith('ext_')) return;
            const p = state.personnel.find(x => x.id === id);
            if (p) {
                const oldStatus = p.status || 'disponivel';
                const assignment = assignments.find(a => a.personnelId === id);
                p.status = 'servico';
                p.statusReason = (assignment ? assignment.post : 'Serviço') + ' em ' + formatDateBR(roster.date);
                p.statusReturnDate = roster.date;

                recordStatusHistory(id, oldStatus, 'servico', p.statusReason);
            }
        });

        closeModal('serviceModal');
        saveState();
        renderServiceRosters();
    });

    document.getElementById('btnAddOtherActivity').onclick = () => {
        const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
        tempOtherActivities.push({
            id: id,
            name: '',
            observation: '',
            personnelIds: []
        });
        renderOtherActivitiesInputs();
    };
}

function editServiceRoster(id) {
    const r = state.serviceRosters.find(x => x.id === id);
    if (!r) return;

    document.getElementById('serviceId').value = r.id;
    document.getElementById('serviceModalTitle').textContent = 'Editar Escala de Serviço';
    document.getElementById('serviceDate').value = r.date;
    
    // Popular tempAssignments
    tempAssignments = {};
    r.assignments.forEach(a => {
        if (!tempAssignments[a.post]) tempAssignments[a.post] = [];
        tempAssignments[a.post].push(a.personnelId);
    });

    tempOtherActivities = r.otherActivities || [];

    renderServicePostsInputs();
    renderOtherActivitiesInputs();
    openModal('serviceModal');
}

function renderServiceRosters() {
    const grid = document.getElementById('serviceRostersList');
    if (!grid) return;

    if (state.serviceRosters.length === 0) {
        grid.innerHTML = '<p style="grid-column:1/-1;color:var(--text-secondary);text-align:center;padding:20px;">Nenhum registro de serviço encontrado.</p>';
        return;
    }

    grid.innerHTML = state.serviceRosters.sort((a,b) => new Date(b.date) - new Date(a.date)).map(s => {
        const details = s.assignments.map(a => {
            let name = 'Desconhecido';
            if (a.personnelId === 'ext_rhickelmi') {
                name = 'Cb RHICKELMI (Externo)';
            } else {
                const p = state.personnel.find(x => x.id === a.personnelId);
                if (p) name = `${p.rank} ${p.warName}`;
            }
            return `<div><strong>${a.post}:</strong> ${name}</div>`;
        }).join('');
        
        let extraDetails = '';
        if (s.otherActivities && s.otherActivities.length > 0) {
            extraDetails = s.otherActivities.map(act => {
                const pNames = act.personnelIds.map(id => {
                    const p = state.personnel.find(x => x.id === id);
                    return p ? `${p.rank} ${p.warName}` : 'Desconhecido';
                }).join(', ');
                return `<div style="margin-top:6px; padding-top:4px; border-top:1px dashed var(--border-color); font-style:italic;">
                    <strong>${act.name}:</strong> ${pNames}<br>
                    <small>${act.observation || ''}</small>
                </div>`;
            }).join('');
        }

        return `
            <div class="notice-card" style="border-left-color: var(--accent-color); font-size:12px; position:relative;">
                <div class="task-actions" style="top:8px; right:8px;">
                    <button class="icon-btn" onclick="editServiceRoster('${s.id}')" title="Editar Escala">
                        <i data-lucide="edit-2" style="width:14px;height:14px"></i>
                    </button>
                    <button class="icon-btn delete" onclick="deleteServiceRoster('${s.id}')">
                        <i data-lucide="trash-2" style="width:14px;height:14px"></i>
                    </button>
                </div>
                <h4 style="color:var(--accent-color); margin-bottom:10px;">Serviço: ${formatDateBR(s.date)}</h4>
                <div style="display:grid; gap:4px;">${details}</div>
                <div style="margin-top:10px;">${extraDetails}</div>
                <div style="margin-top:15px; border-top:1px solid var(--border-color); padding-top:10px;">
                    <button class="btn btn-primary btn-sm" style="width:100%; font-size:11px;" onclick="generateAditamento('${s.id}')">
                        <i data-lucide="file-text" style="width:12px; height:12px; margin-right:4px;"></i> Gerar Aditamento
                    </button>
                </div>
            </div>
        `;
    }).join('');
    lucide.createIcons();
}

function formatDateLong(dateStr) {
    const months = [
        "janeiro", "fevereiro", "março", "abril", "maio", "junho",
        "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
    ];
    const date = new Date(dateStr + 'T12:00:00');
    return `${date.getDate()} de ${months[date.getMonth()]} de ${date.getFullYear()}`;
}

function getDayOfWeek(dateStr) {
    const days = [
        "Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira",
        "Quinta-feira", "Sexta-feira", "Sábado"
    ];
    const date = new Date(dateStr + 'T12:00:00');
    return days[date.getDay()];
}

function generateAditamento(id) {
    const roster = state.serviceRosters.find(r => r.id === id);
    if (!roster) return;

    const biNumber = prompt("Informe o Número do Boletim Interno (BI):", "77") || "[NR]";
    const now = new Date();
    const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    const todayStr = formatDateLong(todayISO);
    const rosterDateStr = formatDateLong(roster.date);
    const rosterDayStr = getDayOfWeek(roster.date);

    // Preparar dados para a tabela de duas colunas
    const assignments = roster.assignments.map(a => {
        const p = state.personnel.find(x => x.id === a.personnelId) || { rank: '', warName: 'EXTERNO' };
        return { post: a.post, rank: p.rank, name: p.warName };
    });

    // Dividir em duas colunas (Esquerda e Direita)
    const mid = Math.ceil(assignments.length / 2);
    const leftCol = assignments.slice(0, mid);
    const rightCol = assignments.slice(mid);
    const maxRows = Math.max(leftCol.length, rightCol.length);

    let assignmentsRows = "";
    for (let i = 0; i < maxRows; i++) {
        const L = leftCol[i] || { post: '', rank: '', name: '' };
        const R = rightCol[i] || { post: '', rank: '', name: '' };
        assignmentsRows += `
            <tr style="height: 25px;">
                <td style="border: 1px solid black; padding: 2px 5px; font-size: 10pt; width: 22%;">${L.post}</td>
                <td style="border: 1px solid black; padding: 2px 5px; text-align: center; font-size: 10pt; width: 8%;">${L.rank}</td>
                <td style="border: 1px solid black; padding: 2px 5px; text-align: center; font-size: 10pt; width: 20%;">${L.name}</td>
                <td style="border: 1px solid black; padding: 2px 5px; font-size: 10pt; width: 22%;">${R.post}</td>
                <td style="border: 1px solid black; padding: 2px 5px; text-align: center; font-size: 10pt; width: 8%;">${R.rank}</td>
                <td style="border: 1px solid black; padding: 2px 5px; text-align: center; font-size: 10pt; width: 20%;">${R.name}</td>
            </tr>`;
    }

    let otherActivitiesHTML = "";
    if (roster.otherActivities && roster.otherActivities.length > 0) {
        otherActivitiesHTML = `<p style="margin-top: 15px;"><strong>OUTRAS ATIVIDADES:</strong></p>`;
        roster.otherActivities.forEach(act => {
            const names = act.personnelIds.map(pid => {
                const p = state.personnel.find(x => x.id === pid);
                return p ? `${p.rank} ${p.warName}` : 'Desconhecido';
            }).join(', ');
            otherActivitiesHTML += `
                <p style="margin: 0; font-size: 10pt;"><strong>${act.name.toUpperCase()}</strong>: ${names} ${act.observation ? '(' + act.observation + ')' : ''}</p>`;
        });
    }

    const htmlContent = `
        <div style="font-family: 'Times New Roman', serif; color: black; background: white; padding: 20px;">
            
            <div style="text-align: center; margin-bottom: 20px;">
                <img src="brasao_11rcmec.png" width="70" height="70" style="margin-bottom: 10px;"><br>
                <span style="font-weight: bold; font-size: 11pt; line-height: 1.2;">MINISTÉRIO DA DEFESA</span><br>
                <span style="font-weight: bold; font-size: 11pt; line-height: 1.2;">EXÉRCITO BRASILEIRO</span><br>
                <span style="font-weight: bold; font-size: 11pt; line-height: 1.2;">11º REGIMENTO DE CAVALARIA MECANIZADO</span><br>
                <span style="font-weight: bold; font-size: 11pt; line-height: 1.2;">REGIMENTO MARECHAL DUTRA</span>
            </div>

            <div style="text-align: center; font-size: 11pt; margin-bottom: 20px;">
                Quartel em Ponta Porã-MS, ${todayStr}
            </div>

            <div style="text-align: center; font-weight: bold; font-size: 12pt; margin-bottom: 25px; text-decoration: underline;">
                Aditamento ao Boletim Interno Nr ${biNumber}
            </div>

            <p style="text-align: justify; font-size: 11pt; margin-bottom: 25px;">Para conhecimento desta SU e devida execução, publico o seguinte:</p>
            
            <div style="text-align: center; margin-bottom: 15px;">
                <p style="margin: 0; font-size: 11pt;"><strong>1ª Parte - SERVIÇOS DIÁRIOS</strong></p>
            </div>

            <p style="margin-top: 10px; font-size: 11pt; text-align: center;">ESCALA DE SERVIÇO para o dia ${rosterDateStr} (${rosterDayStr}):</p>
            
            <table style="width: 95%; border-collapse: collapse; border: 1px solid black; margin: 10px auto;">
                <thead>
                    <tr style="background-color: #d9d9d9;">
                        <th style="border: 1px solid black; padding: 4px; text-align: center; font-size: 9pt; width: 22%;">FUNÇÃO / SET</th>
                        <th style="border: 1px solid black; padding: 4px; text-align: center; font-size: 9pt; width: 8%;">P/G</th>
                        <th style="border: 1px solid black; padding: 4px; text-align: center; font-size: 9pt; width: 20%;">NOME DE GUERRA</th>
                        <th style="border: 1px solid black; padding: 4px; text-align: center; font-size: 9pt; width: 22%;">FUNÇÃO / SET</th>
                        <th style="border: 1px solid black; padding: 4px; text-align: center; font-size: 9pt; width: 8%;">P/G</th>
                        <th style="border: 1px solid black; padding: 4px; text-align: center; font-size: 9pt; width: 20%;">NOME DE GUERRA</th>
                    </tr>
                </thead>
                <tbody>
                    ${assignmentsRows}
                </tbody>
            </table>

            ${otherActivitiesHTML}

            <div style="margin-top: 35px; text-align: center;">
                <p style="margin: 0; font-size: 11pt;"><strong>2ª Parte - INSTRUÇÃO</strong></p>
            </div>
            <p style="margin: 5px 0 0 20px; font-size: 10pt; text-align: center;">Sem alteração</p>

            <div style="margin-top: 35px; text-align: center;">
                <p style="margin: 0; font-size: 11pt;"><strong>3ª Parte - ASSUNTOS GERAIS E ADMINISTRATIVOS</strong></p>
            </div>
            
            <p style="margin: 15px 0 5px 0; font-size: 10pt; font-weight: bold; text-align: center;">1. ASSUNTOS GERAIS:</p>
            <div style="text-align: center; font-size: 10pt;">
                <p style="margin: 2px 0;">- Início de expediente: ${rosterDateStr} às 08:00Hrs.</p>
                <p style="margin: 2px 0;">- Parada diária: ${rosterDateStr} às 07:50Hrs.</p>
                <p style="margin: 2px 0;">- Assuntos relacionados aos militares do Esqd no BI de hoje.</p>
            </div>
            
            <p style="margin: 15px 0 5px 0; font-size: 10pt; font-weight: bold; text-align: center;">2. ASSUNTOS ADMINISTRATIVOS:</p>
            <p style="text-align: center; font-size: 10pt;">Sem Alteração</p>

            <div style="margin-top: 35px; text-align: center;">
                <p style="margin: 0; font-size: 11pt;"><strong>4ª Parte - JUSTIÇA E DISCIPLINA</strong></p>
            </div>
            <p style="margin: 10px 0 0 0; font-size: 10pt; text-align: center;">1. JUSTIÇA: Sem Alteração.</p>
            <p style="margin: 2px 0 0 0; font-size: 10pt; text-align: center;">2. DISCIPLINA: Sem Alteração.</p>
            
            <div style="text-align: center; font-weight: bold; margin-top: 70px; font-size: 11pt;">
                JOSIAS AJALA BLANCO – Cap<br>
                Cmt Esqd C Ap
            </div>
        </div>
    `;

    const header = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head><meta charset='utf-8'><style>
            @page { size: 21cm 29.7cm; margin: 2cm; }
            body { font-family: 'Times New Roman', serif; }
            td { vertical-align: middle; }
        </style></head><body>`;
    const footer = "</body></html>";
    const fullHTML = header + htmlContent + footer;

    const blob = new Blob([fullHTML], { type: 'application/msword' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Aditamento_ao_BI_Nr_${biNumber}.doc`;
    a.click();
}

function deleteServiceRoster(id) {
    if (confirm('Excluir este registro de serviço? Ao excluir, os militares escalados retornarão ao status Disponível.')) {
        const roster = state.serviceRosters.find(s => s.id === id);
        if (roster) {
            roster.assignments.forEach(a => {
                if (a.personnelId.startsWith('ext_')) return;
                const p = state.personnel.find(x => x.id === a.personnelId);
                if (p) {
                    p.status = 'disponivel';
                    p.statusReason = '';
                    p.statusReturnDate = '';
                }
            });
        }
        state.serviceRosters = state.serviceRosters.filter(s => s.id !== id);
        saveState();
        renderServiceRosters();
        renderEscala();
        renderDashboard();
    }
}

// Inicializar formulários e eventos
document.addEventListener('DOMContentLoaded', () => {
    setupMissionForm();
    setupServiceForm();
    setupTabs();
    
    const btnSaveCal = document.getElementById('btnSaveCalEvent');
    if (btnSaveCal) {
        btnSaveCal.addEventListener('click', () => {
            const dateStr = document.getElementById('calModalDate').value;
            const titleEl = document.getElementById('newCalEventTitle');
            const descEl = document.getElementById('newCalEventDesc');
            const catEl = document.getElementById('newCalEventCategory');
            
            const title = titleEl ? titleEl.value.trim() : '';
            const description = descEl ? descEl.value.trim() : '';
            const category = catEl ? catEl.value : 'info';
            
            if (title) {
                state.calendarEvents.push({
                    id: Date.now().toString(),
                    date: dateStr,
                    title,
                    description,
                    category
                });
                
                saveState();
                renderCalendar();
                renderDayEventsList(dateStr);
                
                if (titleEl) titleEl.value = '';
                if (descEl) descEl.value = '';
                if (catEl) catEl.value = 'info';
                closeModal('calendarModal');
            } else {
                alert("Por favor, insira um título para o evento.");
            }
        });
    }
});

function formatDateBR(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

// === GESTÃO DE USUÁRIOS (ADMIN) ===
function renderUsers() {
    const list = document.getElementById('userManagementList');
    if (!list) return;

    db.ref('users').once('value', snap => {
        const users = snap.val() || {};
        list.innerHTML = Object.keys(users).map(uid => {
            const u = users[uid];
            const isMe = currentUser && currentUser.uid === uid;
            const isAdminEmail = u.email === ADMIN_EMAIL;

            return `
                <tr>
                    <td><strong>${u.name}</strong></td>
                    <td style="color:var(--text-secondary)">${u.email}</td>
                    <td>
                        <button class="btn btn-outline btn-sm" onclick="openPermissionsModal('${uid}')" ${isAdminEmail && !isMe ? 'disabled' : ''}>
                            <i data-lucide="sliders"></i> Permissões
                        </button>
                    </td>
                    <td style="text-align:right">
                        ${!(isMe || isAdminEmail) ? `
                        <button class="icon-btn delete" onclick="deleteUser('${uid}')">
                            <i data-lucide="user-minus"></i>
                        </button>` : '<span style="font-size:11px;color:var(--text-secondary)">Protegido</span>'}
                    </td>
                </tr>
            `;
        }).join('');
        lucide.createIcons();
    });
}

function changeUserRole(uid, newRole) {
    if (confirm(`Mudar papel deste usuário para ${newRole}?`)) {
        db.ref('users/' + uid + '/role').set(newRole).then(() => {
            renderUsers();
        });
    } else {
        renderUsers();
    }
}

function deleteUser(uid) {
    if (confirm('REMOVER este usuário do sistema? Ele perderá acesso imediatamente.')) {
        db.ref('users/' + uid).remove().then(() => {
            renderUsers();
        });
    }
}

function openPermissionsModal(uid) {
    db.ref('users/' + uid).once('value', snap => {
        const u = snap.val();
        if (!u) return;

        document.getElementById('permUserId').value = uid;
        document.getElementById('permUserName').textContent = u.name;

        // Carrega permissões atuais (ou usa os padrões legados)
        const perms = u.permissions || getLegacyPermissions(u.role || 'reader');

        document.getElementById('perm_isAdmin').checked = !!perms.isAdmin;
        document.getElementById('perm_managePersonnel').checked = !!perms.managePersonnel;
        document.getElementById('perm_deletePersonnel').checked = !!perms.deletePersonnel;
        document.getElementById('perm_manageRoster').checked = !!perms.manageRoster;
        document.getElementById('perm_viewTasks').checked = !!perms.viewTasks;
        document.getElementById('perm_manageTasks').checked = !!perms.manageTasks;
        document.getElementById('perm_viewRestricted').checked = !!perms.viewRestricted;
        document.getElementById('perm_addOccurrences').checked = !!perms.addOccurrences;

        openModal('permissionsModal');
    });
}

document.getElementById('permissionsForm').addEventListener('submit', e => {
    e.preventDefault();
    if (!hasPermission('isAdmin')) return;

    const uid = document.getElementById('permUserId').value;
    const permissions = {
        isAdmin: document.getElementById('perm_isAdmin').checked,
        managePersonnel: document.getElementById('perm_managePersonnel').checked,
        deletePersonnel: document.getElementById('perm_deletePersonnel').checked,
        manageRoster: document.getElementById('perm_manageRoster').checked,
        viewTasks: document.getElementById('perm_viewTasks').checked,
        manageTasks: document.getElementById('perm_manageTasks').checked,
        viewRestricted: document.getElementById('perm_viewRestricted').checked,
        addOccurrences: document.getElementById('perm_addOccurrences').checked
    };

    db.ref('users/' + uid + '/permissions').set(permissions).then(() => {
        closeModal('permissionsModal');
        alert("Permissões atualizadas com sucesso!");
    });
});

function openAddUserModal() {
    document.getElementById('addUserForm').reset();
    // Reset role cards visual state
    document.querySelectorAll('.role-card').forEach(c => {
        c.style.borderColor = 'var(--border-color)';
        c.style.background = '';
        c.querySelectorAll('i,div').forEach(el => el.style.color = '');
    });
    // Highlight default (reader)
    const defaultCard = document.querySelector('.role-card');
    if (defaultCard) setRoleCard(defaultCard, 'reader');
    openModal('addUserModal');
}

window.setRoleCard = function(cardEl, role) {
    document.querySelectorAll('.role-card').forEach(c => {
        c.style.borderColor = 'var(--border-color)';
        c.style.background = '';
    });
    cardEl.style.borderColor = '#0369a1';
    cardEl.style.background = 'rgba(3,105,161,0.07)';
    // Check the radio
    const radio = cardEl.closest('label').querySelector('input[type="radio"]');
    if (radio) radio.checked = true;
};

// Formulário de criação de usuário pelo Admin
document.getElementById('addUserForm').addEventListener('submit', e => {
    e.preventDefault();
    if (!hasPermission('isAdmin')) return;

    const name  = document.getElementById('newUserName').value.trim();
    const email = document.getElementById('newUserEmail').value.trim();
    const pass  = document.getElementById('newUserPassword').value;
    const roleInput = document.querySelector('input[name="newUserRole"]:checked');
    const role  = roleInput ? roleInput.value : 'reader';
    const permissions = getLegacyPermissions(role);

    const submitBtn = e.target.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Criando...';

    // Usar uma instância secundária do Firebase Auth para não deslogar o Admin atual
    const secondaryApp = firebase.apps.find(a => a.name === 'secondary') 
        || firebase.initializeApp(firebase.app().options, 'secondary');
    const secondaryAuth = firebase.auth(secondaryApp);

    secondaryAuth.createUserWithEmailAndPassword(email, pass)
        .then(cred => {
            return db.ref('users/' + cred.user.uid).set({
                name: name,
                email: email,
                role: role,
                permissions: permissions
            }).then(() => secondaryAuth.signOut());
        })
        .then(() => {
            closeModal('addUserModal');
            renderUsers();
            alert(`Usuário "${name}" criado com sucesso como ${role}!`);
        })
        .catch(err => {
            alert('Erro ao criar usuário: ' + err.message);
        })
        .finally(() => {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Criar Usuário';
        });
});

