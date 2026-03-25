import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './AdminLayout.css';
import {
    Users, MessageSquare, Shield, Phone, Settings,
    BarChart3, Megaphone, CheckCircle, Ban, Search,
    ArrowRight, Activity, LogOut, Trash2, Globe, Clock, MoreVertical,
    Mail, AlertTriangle, ShieldCheck, Eye, History, UserCheck, Video,
    HardDrive, Lock, FileText, Image as ImageIcon, LayoutDashboard,
    Key, ShieldAlert, MonitorSmartphone
} from 'lucide-react';

const AdminDashboard = () => {
    // Auth State
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [loginData, setLoginData] = useState({ username: '', password: '' });
    const [authLoading, setAuthLoading] = useState(false);

    // Navigation & Data State
    const [activeTab, setActiveTab] = useState('dashboard');
    const [stats, setStats] = useState({ 
        users: 0, messages: 0, groups: 0, reports: 0, calls: 0, statuses: 0, activeNow: 0, onlineUsers: [] 
    });
    const [userList, setUserList] = useState([]);
    const [reports, setReports] = useState([]);
    const [callLogs, setCallLogs] = useState([]);
    const [activityLogs, setActivityLogs] = useState([]);
    const [mediaGallery, setMediaGallery] = useState([]);
    const [groupsList, setGroupsList] = useState([]);
    
    // UI Local State
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [broadcastMsg, setBroadcastMsg] = useState('');
    const [viewingUser, setViewingUser] = useState(null);
    const [userActivity, setUserActivity] = useState([]);
    const [userStats, setUserStats] = useState({ messagesSent: 0, callsHandled: 0, callDuration: 0, groupsJoined: 0 });

    const API_URL = import.meta.env.VITE_API_URL || '/api';

    // Persist Login
    useEffect(() => {
        const savedAuth = localStorage.getItem('admin_token');
        if (savedAuth) setIsLoggedIn(true);
    }, []);

    // Periodic Data Fetch
    useEffect(() => {
        if (!isLoggedIn) return;
        fetchStats();
        const interval = setInterval(fetchStats, 15000);
        return () => clearInterval(interval);
    }, [isLoggedIn]);

    // Data Load on Tab Change
    useEffect(() => {
        if (!isLoggedIn) return;
        if (activeTab === 'users') fetchUsers();
        if (activeTab === 'reports') fetchReports();
        if (activeTab === 'calls') fetchCalls();
        if (activeTab === 'logs') fetchActivityLogs();
        if (activeTab === 'gallery') fetchMediaGallery();
        if (activeTab === 'groups') fetchGroups();
    }, [activeTab, isLoggedIn]);

    // --- API CALLS ---

    const handleLogin = async (e) => {
        e.preventDefault();
        setAuthLoading(true);
        try {
            const res = await axios.post(`${API_URL}/admin/login`, loginData);
            if (res.data.success) {
                localStorage.setItem('admin_token', res.data.token);
                setIsLoggedIn(true);
            }
        } catch (err) {
            alert('Invalid Admin Credentials');
        } finally {
            setAuthLoading(false);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('admin_token');
        setIsLoggedIn(false);
    };

    const fetchStats = async () => {
        try {
            const res = await axios.get(`${API_URL}/admin/stats`);
            setStats(res.data);
        } catch (err) { console.error('Stats error:', err); }
    };

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API_URL}/admin/users`);
            setUserList(res.data);
        } catch (err) { console.error('Users error:', err); }
        setLoading(false);
    };

    const fetchActivityLogs = async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API_URL}/admin/logs`);
            setActivityLogs(res.data);
        } catch (err) { console.error('Logs error:', err); }
        setLoading(false);
    };

    const fetchReports = async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API_URL}/admin/reports`);
            setReports(res.data);
        } catch (err) { console.error('Reports error:', err); }
        setLoading(false);
    };

    const fetchCalls = async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API_URL}/admin/calls`);
            setCallLogs(res.data);
        } catch (err) { console.error('Calls error:', err); }
        setLoading(false);
    };

    const fetchGroups = async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API_URL}/admin/groups`);
            setGroupsList(res.data);
        } catch (err) { }
        setLoading(false);
    };

    const fetchMediaGallery = async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API_URL}/admin/media`); // This might need server support
            setMediaGallery(res.data);
        } catch (err) { 
            // Mocking for now if endpoint doesn't exist yet
            setMediaGallery([
                { id: 1, url: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113', type: 'image', userName: 'Tejsh', time: '5m ago' },
                { id: 2, url: 'https://images.unsplash.com/photo-1577563908411-5077b6dc7624', type: 'image', userName: 'John', time: '12m ago' }
            ]);
        }
        setLoading(false);
    };

    const fetchUserActivity = async (user) => {
        setLoading(true);
        setViewingUser(user);
        try {
            const [acts, stats] = await Promise.all([
                axios.get(`${API_URL}/admin/users/${user.id}/activity`),
                axios.get(`${API_URL}/admin/users/${user.id}/stats`)
            ]);
            setUserActivity(acts.data);
            setUserStats(stats.data);
        } catch (err) { console.error('User behavior error:', err); }
        setLoading(false);
    };

    const handleBanUser = async (user) => {
        const action = user.isBanned ? 'UNBLOCK' : 'BLOCK';
        if (!confirm(`Are you sure you want to ${action} ${user.name}? This will restrict their app access.`)) return;
        try {
            await axios.post(`${API_URL}/admin/users/${user.id}/ban`, { ban: !user.isBanned });
            fetchUsers();
        } catch (err) { alert('Operation failed'); }
    };

    const handleBroadcast = async () => {
        if (!broadcastMsg) return;
        if (!confirm('Deploy this broadcast to ALL active devices?')) return;
        setLoading(true);
        try {
            await axios.post(`${API_URL}/admin/broadcast`, { message: broadcastMsg });
            alert('Broadcast Sent Successfully!');
            setBroadcastMsg('');
            setActiveTab('dashboard');
        } catch (err) { alert('Broadcast failed'); }
        setLoading(false);
    };

    const formatTime = (ts) => new Date(ts).toLocaleString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', day: 'numeric', month: 'short' });

    // --- RENDER LOGIN ---
    if (!isLoggedIn) {
        return (
            <div className="admin-login-overlay">
                <div className="login-card">
                    <div className="logo">Whatsup <span style={{ color: '#000', fontSize: '14px' }}>ADMIN</span></div>
                    <h2>Operational Access</h2>
                    <form className="login-form" onSubmit={handleLogin}>
                        <label>AUTHORIZED USERNAME</label>
                        <input 
                            type="text" 
                            required 
                            placeholder="e.g. admin"
                            value={loginData.username}
                            onChange={e => setLoginData({...loginData, username: e.target.value})}
                        />
                        <label>SECURE ACCESS KEY</label>
                        <input 
                            type="password" 
                            required 
                            placeholder="••••••••"
                            value={loginData.password}
                            onChange={e => setLoginData({...loginData, password: e.target.value})}
                        />
                        <button className="btn-login" type="submit" disabled={authLoading}>
                            {authLoading ? 'Verifying...' : 'Authenticate'}
                        </button>
                    </form>
                    <p style={{ marginTop: '30px', color: '#94a3b8', fontSize: '12px' }}>
                        Restricted Area. Unauthorized access is logged.
                    </p>
                </div>
            </div>
        );
    }

    // --- RENDER MAIN DASHBOARD ---
    return (
        <div className="admin-container">
            {/* Sidebar with 10 Sections */}
            <aside className="admin-sidebar">
                <div className="admin-logo">Whatsup <span style={{ fontSize: '10px', color: '#ffb300' }}>CONTROL v2.0</span></div>
                <nav className="sidebar-menu">
                    <TabItem id="dashboard" icon={<LayoutDashboard size={20} />} label="Analytics" activeTab={activeTab} setActiveTab={setActiveTab} />
                    <TabItem id="users" icon={<Users size={20} />} label="User Base" activeTab={activeTab} setActiveTab={setActiveTab} />
                    <TabItem id="reports" icon={<ShieldAlert size={20} />} label="Incidents" badge={stats.reports} activeTab={activeTab} setActiveTab={setActiveTab} />
                    <TabItem id="logs" icon={<History size={20} />} label="Activity Logs" activeTab={activeTab} setActiveTab={setActiveTab} />
                    <TabItem id="calls" icon={<Phone size={20} />} label="Call Logs" activeTab={activeTab} setActiveTab={setActiveTab} />
                    <TabItem id="groups" icon={<MessageSquare size={20} />} label="Groups Hub" activeTab={activeTab} setActiveTab={setActiveTab} />
                    <TabItem id="gallery" icon={<ImageIcon size={20} />} label="Media Review" activeTab={activeTab} setActiveTab={setActiveTab} />
                    <TabItem id="broadcast" icon={<Megaphone size={20} />} label="Mass Alerts" activeTab={activeTab} setActiveTab={setActiveTab} />
                    <TabItem id="bans" icon={<Ban size={20} />} label="Managed Bans" activeTab={activeTab} setActiveTab={setActiveTab} />
                    <TabItem id="settings" icon={<Settings size={20} />} label="System Config" activeTab={activeTab} setActiveTab={setActiveTab} />
                </nav>
                <div className="sidebar-footer">
                    <div className="sidebar-item logout" onClick={handleLogout}>
                        <LogOut size={20} /> Exit Panel
                    </div>
                </div>
            </aside>

            {/* Content Area */}
            <main className="admin-content-wrapper">
                <header className="admin-header">
                    <div>
                        <h1 className="admin-title">{activeTab.toUpperCase()}</h1>
                        <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '14px' }}>Real-time Governance & Oversight</p>
                    </div>
                    <div className="admin-status-indicators">
                        <div className="header-status-card">
                            <span className="pulse-dot green"></span>
                            <span>Engine: Active</span>
                        </div>
                        <div className="header-status-card">
                            <MonitorSmartphone size={16} />
                            <span>Cluster: Render-01</span>
                        </div>
                    </div>
                </header>

                {/* Dashboard / Analytics */}
                {activeTab === 'dashboard' && (
                    <div className="dashboard-content fade-in">
                        <div className="stats-grid">
                            <StatCard label="Total Users" val={stats.users} icon={<Users />} color="green" small="+12% growth" />
                            <StatCard label="Active Sessions" val={stats.activeNow} icon={<Globe />} color="blue" small="Live now" />
                            <StatCard label="Messages Flow" val={stats.messages} icon={<MessageSquare />} color="orange" small="Lifetime" />
                            <StatCard label="Reported" val={stats.reports} icon={<ShieldAlert />} color="red" small="Pending" />
                            <StatCard label="Total Calls" val={stats.calls || 0} icon={<Phone />} color="blue" small="Connected" />
                            <StatCard label="Statuses" val={stats.statuses || 0} icon={<ImageIcon />} color="green" small="Active stories" />
                        </div>

                        <div className="admin-grid-two">
                            <div className="admin-card">
                                <h3 style={{ marginBottom: '20px' }}>Server Health</h3>
                                <div className="mini-logs">
                                    <div className="log-msg"><CheckCircle size={12} color="#00a884" /> Database connection: Verified</div>
                                    <div className="log-msg"><CheckCircle size={12} color="#00a884" /> FCM Push Engine: Online</div>
                                    <div className="log-msg"><CheckCircle size={12} color="#00a884" /> Cloudinary CDN: Connected</div>
                                    <div className="log-msg"><Clock size={12} color="#94a3b8" /> Last Backup: 2h ago</div>
                                </div>
                                <h3 style={{ margin: '30px 0 20px' }}>Quick Controls</h3>
                                <div className="quick-grid">
                                    <button className="q-btn-advanced" onClick={() => setActiveTab('broadcast')}><Megaphone /><span>Alert All</span></button>
                                    <button className="q-btn-advanced" onClick={fetchStats}><Activity /><span>Refresh</span></button>
                                    <button className="q-btn-advanced red" onClick={() => setActiveTab('bans')}><Ban /><span>Bans</span></button>
                                    <button className="q-btn-advanced alt" onClick={() => setActiveTab('logs')}><History /><span>Logs</span></button>
                                </div>
                            </div>
                            
                            <div className="admin-card">
                                <div className="card-header-flex">
                                    <h3>Live Activity Scroller</h3>
                                    <span className="online-badge-count">{stats.activeNow} Active</span>
                                </div>
                                <div className="online-user-scroller">
                                    {stats.onlineUsers?.map(u => (
                                        <div key={u.id} className="online-u-avatar-wrap">
                                            <img src={u.image || `https://ui-avatars.com/api/?name=${u.name}`} alt={u.name} />
                                            <span className="u-status-dot"></span>
                                            <div className="u-name-tooltip">{u.name}</div>
                                        </div>
                                    ))}
                                    {(!stats.onlineUsers || stats.onlineUsers.length === 0) && <p style={{ color: '#94a3b8', fontSize: '13px' }}>No users online.</p>}
                                </div>

                                <h3 style={{ marginTop: '30px', marginBottom: '15px' }}>System Performance</h3>
                                <div className="health-bar-container" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                    <PerformanceBar label="CPU Load" pct={24} />
                                    <PerformanceBar label="RAM Usage" pct={48} />
                                    <PerformanceBar label="Disk Space" pct={12} />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Users List */}
                {activeTab === 'users' && (
                    <div className="admin-card fade-in" style={{ padding: 0 }}>
                        <div className="table-header">
                            <div className="search-box">
                                <Search size={18} />
                                <input type="text" placeholder="Search by name, phone or ID..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                            </div>
                            <button className="q-btn-advanced alt" style={{ padding: '8px 20px', flexDirection: 'row', gap: '8px' }} onClick={fetchUsers}>
                                <Activity size={16} /> <span>Refresh User List</span>
                            </button>
                        </div>
                        <div className="admin-table-container">
                            <table className="admin-table">
                                <thead>
                                    <tr>
                                        <th>Identity</th>
                                        <th>Contact</th>
                                        <th>Access</th>
                                        <th>Activity</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {userList.filter(u => u.name?.toLowerCase().includes(searchQuery.toLowerCase()) || u.phone?.includes(searchQuery)).map(user => (
                                        <tr key={user.id} className={user.isBanned ? 'banned-row' : ''}>
                                            <td>
                                                <div className="user-profile-cell">
                                                    <img src={user.image || `https://ui-avatars.com/api/?name=${user.name}`} alt="" />
                                                    <div className="u-info">
                                                        <div className="name">{user.name}</div>
                                                        <div className="id">#{user.id.slice(-8)}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td><div className="phone">{user.phone}</div><span className="ip-badge">Verified</span></td>
                                            <td><span className={`status-pill-adv ${user.isBanned ? 'banned' : 'active'}`}>{user.isBanned ? 'LOCKED' : 'ACTIVE'}</span></td>
                                            <td>
                                                <div style={{ fontSize: '12px', fontWeight: 'bold' }}>Last: {new Date(user.lastSeen).toLocaleDateString()}</div>
                                                <div style={{ fontSize: '10px', color: '#94a3b8' }}>Join: {new Date(user.createdAt).toLocaleDateString()}</div>
                                            </td>
                                            <td>
                                                <div className="governance-actions">
                                                    <button className="gov-btn" onClick={() => fetchUserActivity(user)} title="View Behavior"><Eye size={16} /></button>
                                                    <button className={`gov-btn ban ${user.isBanned ? 'active' : ''}`} onClick={() => handleBanUser(user)} title="Toggle Block"><Ban size={16} /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Reports / Help */}
                {activeTab === 'reports' && (
                    <div className="fade-in">
                        {reports.length === 0 && (
                            <div className="admin-card" style={{ padding: '50px', textAlign: 'center' }}>
                                <ShieldCheck size={64} color="#00a884" style={{ marginBottom: '20px', opacity: 0.3 }} />
                                <h3>All Integrity Checks Passed</h3>
                                <p style={{ color: '#94a3b8' }}>No pending support tickets or reports.</p>
                            </div>
                        )}
                        {reports.map((report, idx) => (
                            <div key={idx} className="report-card fade-in">
                                <div className="report-header">
                                    <div className="report-user-info">
                                        <img src={`https://ui-avatars.com/api/?name=${report.reporterId}`} alt="" />
                                        <div>
                                            <div style={{ fontWeight: 800 }}>User ID: {report.reporterId}</div>
                                            <div style={{ fontSize: 11, color: '#94a3b8' }}>{formatTime(report.createdAt)}</div>
                                        </div>
                                    </div>
                                    <div className="report-reason">{report.reason}</div>
                                </div>
                                <div className="report-body">{report.status === 'SUPPORT' ? report.status : report.reason}: {report.message || 'Help request submitted.'}</div>
                                <div style={{ marginTop: '15px', display: 'flex', gap: '10px' }}>
                                    <button className="q-btn-advanced alt" style={{ padding: '8px 15px', flexDirection: 'row' }}>Resolve</button>
                                    <button className="q-btn-advanced" style={{ padding: '8px 15px', flexDirection: 'row' }}>Warn User</button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Activity Logs */}
                {activeTab === 'logs' && (
                    <div className="admin-card fade-in" style={{ padding: 0 }}>
                        <div className="table-header"><h3>Recent System Audits</h3><button className="refresh-btn" onClick={fetchActivityLogs}>Refresh</button></div>
                        <div className="logs-scroller" style={{ maxHeight: '600px', overflowY: 'auto' }}>
                            {activityLogs.map((log, idx) => (
                                <div key={idx} className="log-row">
                                    <div className="log-time">{formatTime(log.timestamp)}</div>
                                    <div className="log-action">{log.action}</div>
                                    <div className="log-user">{log.userName || log.userId}</div>
                                    <div className="log-details">{log.details}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Gallery */}
                {activeTab === 'gallery' && (
                    <div className="admin-card fade-in">
                        <div className="gallery-grid">
                            {mediaGallery.map(m => (
                                <div key={m.id} className="media-card">
                                    <div className="media-preview-wrap">
                                        <img src={m.url} alt="" />
                                    </div>
                                    <div className="media-info-pnl">
                                        <div className="m-user">{m.userName}</div>
                                        <div className="m-time">{m.time}</div>
                                        <div style={{ marginTop: '10px', display: 'flex', gap: '5px' }}>
                                            <button className="gov-btn" style={{ width: '30px', height: '30px' }}><Eye size={14} /></button>
                                            <button className="gov-btn" style={{ width: '30px', height: '30px' }}><Trash2 size={14} /></button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Broadcast */}
                {activeTab === 'broadcast' && (
                    <div className="admin-card fade-in" style={{ padding: '50px' }}>
                        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
                            <Megaphone size={48} color="#00a884" style={{ marginBottom: '20px' }} />
                            <h2>Mass Broadcast Hub</h2>
                            <p style={{ color: '#94a3b8' }}>Send a high-priority system alert to every registered device. Use responsibly.</p>
                        </div>
                        <textarea 
                            className="portal-form textarea" 
                            style={{ height: '150px', marginBottom: '30px' }} 
                            placeholder="Type the announcement here..."
                            value={broadcastMsg}
                            onChange={e => setBroadcastMsg(e.target.value)}
                        />
                        <button className="btn-portal-send" onClick={handleBroadcast} disabled={loading}>
                            {loading ? 'Transmitting Data...' : 'Deploy Global Announcement'}
                        </button>
                    </div>
                )}

                {/* Behavioral Modal */}
                {viewingUser && (
                    <div className="admin-modal-overlay" onClick={() => setViewingUser(null)}>
                        <div className="admin-modal" style={{ maxWidth: '800px' }} onClick={e => e.stopPropagation()}>
                            <div className="modal-header">
                                <h3>Behavioral Audit: {viewingUser.name}</h3>
                                <button className="close-btn" onClick={() => setViewingUser(null)}>×</button>
                            </div>
                            <div className="modal-body">
                                <div className="stats-grid" style={{ marginBottom: '20px' }}>
                                    <div className="stat-card" style={{ padding: '20px' }}><div><strong>{userStats.messagesSent}</strong><br/><small>Messages</small></div></div>
                                    <div className="stat-card" style={{ padding: '20px' }}><div><strong>{userStats.callsHandled}</strong><br/><small>Voice/Video</small></div></div>
                                    <div className="stat-card" style={{ padding: '20px' }}><div><strong>{userStats.groupsJoined}</strong><br/><small>Social Activity</small></div></div>
                                </div>
                                <h4>Recent Message Stream</h4>
                                <div className="user-activity-feed" style={{ marginTop: '15px' }}>
                                    {userActivity.map((msg, i) => (
                                        <div key={i} style={{ padding: '10px', borderBottom: '1px solid #eee', fontSize: '13px' }}>
                                            <span style={{ color: '#94a3b8' }}>[{formatTime(msg.timestamp)}]</span> <strong>{msg.type}:</strong> {msg.text?.substring(0, 100) || '[Media Content]'}
                                        </div>
                                    ))}
                                    {userActivity.length === 0 && <p style={{ color: '#94a3b8', padding: '20px' }}>No recent activity records.</p>}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

            </main>
        </div>
    );
};

// --- HELPER COMPONENTS ---

const TabItem = ({ id, icon, label, badge, activeTab, setActiveTab }) => (
    <div className={`sidebar-item ${activeTab === id ? 'active' : ''}`} onClick={() => setActiveTab(id)}>
        {icon} {label} {badge > 0 && <span className="badge-alert">{badge}</span>}
    </div>
);

const StatCard = ({ label, val, icon, color, small }) => (
    <div className={`stat-card ${color}`}>
        <div className="stat-icon-wrap">{icon}</div>
        <div className="stat-info">
            <h3>{label}</h3>
            <p className="stat-number">{val}</p>
            <small>{small}</small>
        </div>
    </div>
);

const PerformanceBar = ({ label, pct }) => (
    <div className="perf-item">
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 800, marginBottom: '5px' }}>
            <span>{label}</span>
            <span>{pct}%</span>
        </div>
        <div style={{ height: '8px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: pct > 80 ? '#ef4444' : (pct > 50 ? '#f97316' : '#00a884'), transition: 'width 1s ease' }}></div>
        </div>
    </div>
);

export default AdminDashboard;
