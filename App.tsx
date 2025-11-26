import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  RotateCcw, 
  Plus, 
  Trash2, 
  Menu, 
  BarChart3, 
  X, 
  Check, 
  Calendar,
  ChevronRight,
  PlusCircle,
  Pencil,
  Save,
  AlertTriangle,
  List,
  PieChart,
  Clock,
  Trophy,
  Filter,
  Trash,
  Archive,
  CalendarPlus,
  CalendarRange,
  ChevronDown
} from 'lucide-react';

// --- Types ---

interface DailyLog {
  [date: string]: number; // "YYYY-MM-DD": count
}

interface Project {
  id: string;
  name: string;
  count: number; // The current visual number (session/scratchpad)
  logs: DailyLog; // Historical record of increments
  createdAt: number;
  lastActiveDate: string; // "YYYY-MM-DD" - Tracks which 'list' (day) this belongs to
}

const STORAGE_KEY = 'bigtap_data_v2';
const LEGACY_STORAGE_KEY = 'bigtap_data'; // Fallback for data migration
const RECENT_NAMES_KEY = 'bigtap_recent_names';
const STATS_START_DATE_KEY = 'bigtap_stats_start_date';

// --- Helper Functions ---

const generateId = () => Math.random().toString(36).substr(2, 9);

const getTodayString = () => {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const localDate = new Date(d.getTime() - (offset*60*1000));
  return localDate.toISOString().split('T')[0];
};

const formatDateDisplay = (dateStr: string) => {
  const today = getTodayString();
  if (dateStr === today) return '今天 (Today)';
  
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('zh-TW', { 
    weekday: 'short', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  }).format(date);
};

// Returns a date string for 6 months ago (Default)
const getSixMonthsAgoString = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().split('T')[0];
};

// --- Components ---

const App: React.FC = () => {
  // --- State ---
  
  const [projects, setProjects] = useState<Project[]>(() => {
    try {
      let saved = localStorage.getItem(STORAGE_KEY);
      
      // MIGRATION CHECK: If no v2 data, try loading legacy data
      if (!saved) {
        const legacyData = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacyData) {
          saved = legacyData;
        }
      }

      let loadedProjects: Project[] = [];
      
      if (saved) {
        loadedProjects = JSON.parse(saved);
      } else {
        // Migrate from old simple counter if exists (very old version)
        const oldSimpleCount = localStorage.getItem('bigtap_counter_value');
        if (oldSimpleCount) {
          const val = parseInt(oldSimpleCount, 10) || 0;
          const today = getTodayString();
          const initialLog = val > 0 ? { [today]: val } : {};
          loadedProjects = [{
            id: generateId(),
            name: '默認計數 (Default)',
            count: val,
            logs: initialLog,
            createdAt: Date.now(),
            lastActiveDate: today
          }];
        }
      }

      const todayStr = getTodayString();

      // 1. Data Migration: Ensure lastActiveDate exists
      loadedProjects = loadedProjects.map(p => {
        if (p.lastActiveDate) return p;
        
        // Infer last active date if missing
        const logDates = Object.keys(p.logs).sort();
        const lastLogDate = logDates.length > 0 ? logDates[logDates.length - 1] : todayStr;
        return {
          ...p,
          lastActiveDate: lastLogDate
        };
      });

      if (loadedProjects.length === 0) {
        return [{
          id: generateId(),
          name: '默認計數 (Default)',
          count: 0,
          logs: {},
          createdAt: Date.now(),
          lastActiveDate: todayStr
        }];
      }

      // 2. Smart Carryover Logic
      const hasProjectsForToday = loadedProjects.some(p => p.lastActiveDate === todayStr);

      if (!hasProjectsForToday) {
        const allDates = new Set<string>();
        loadedProjects.forEach(p => Object.keys(p.logs).forEach(d => allDates.add(d)));
        loadedProjects.forEach(p => allDates.add(p.lastActiveDate));
        
        const sortedDates = Array.from(allDates).sort().reverse();
        const latestDate = sortedDates.find(d => d < todayStr);

        if (latestDate) {
          loadedProjects = loadedProjects.map(p => {
            if (p.lastActiveDate === latestDate || (p.logs[latestDate] || 0) > 0) {
              return { ...p, count: 0, lastActiveDate: todayStr };
            }
            return p;
          });
        }
      }

      return loadedProjects;

    } catch (e) {
      console.error("Failed to load data", e);
      return [{
        id: generateId(),
        name: '默認計數 (Default)',
        count: 0,
        logs: {},
        createdAt: Date.now(),
        lastActiveDate: getTodayString()
      }];
    }
  });

  const [recentNames, setRecentNames] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(RECENT_NAMES_KEY);
      if (saved) return JSON.parse(saved);
      return [];
    } catch (e) {
      return [];
    }
  });

  const [activeProjectId, setActiveProjectId] = useState<string>(() => {
    return projects[0]?.id || '';
  });

  const [isPressed, setIsPressed] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showFactoryResetConfirm, setShowFactoryResetConfirm] = useState(false);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  
  // Stats State
  const [showStats, setShowStats] = useState(false);
  const [statsView, setStatsView] = useState<'overview' | 'history'>('overview');
  const [statsStartDate, setStatsStartDate] = useState<string>(() => {
    try {
      return localStorage.getItem(STATS_START_DATE_KEY) || getSixMonthsAgoString();
    } catch {
      return getSixMonthsAgoString();
    }
  });
  const [showDateSettings, setShowDateSettings] = useState(false);

  // Manual Log State
  const [showManualLog, setShowManualLog] = useState(false);
  const [manualLogDate, setManualLogDate] = useState(getTodayString());
  const [manualLogCount, setManualLogCount] = useState('');
  const [manualLogProjectId, setManualLogProjectId] = useState<string>('');

  const [newProjectName, setNewProjectName] = useState('');

  // Editing state
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');

  // Deletion Confirmation State
  const [deleteTarget, setDeleteTarget] = useState<{ 
    type: 'project' | 'log', 
    projectId: string, 
    date?: string, 
    name?: string, 
    hasHistory?: boolean 
  } | null>(null);

  // --- Derived State ---

  const activeProject = projects.find(p => p.id === activeProjectId) || projects[0];

  useEffect(() => {
    if (!activeProject) {
      const today = getTodayString();
      const visible = projects.find(p => p.lastActiveDate === today);
      if (visible) {
        setActiveProjectId(visible.id);
      } else if (projects.length > 0) {
        setActiveProjectId(projects[0].id);
      } else {
        const newDefault: Project = {
          id: generateId(),
          name: '默認計數 (Default)',
          count: 0,
          logs: {},
          createdAt: Date.now(),
          lastActiveDate: today
        };
        setProjects([newDefault]);
        setActiveProjectId(newDefault.id);
      }
    }
  }, [activeProject, projects]);

  // Seed recent names
  useEffect(() => {
    if (recentNames.length === 0 && projects.length > 0) {
      const existingNames = Array.from(new Set(projects.map(p => p.name.trim()))).slice(0, 10);
      if (existingNames.length > 0) {
        setRecentNames(existingNames);
        localStorage.setItem(RECENT_NAMES_KEY, JSON.stringify(existingNames));
      }
    }
  }, []);

  // --- Persistence ---

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  }, [projects]);

  // --- Handlers ---

  const handleIncrement = useCallback(() => {
    const today = getTodayString();
    
    setProjects(prev => prev.map(p => {
      if (p.id === activeProjectId) {
        const currentDaily = p.logs[today] || 0;
        return {
          ...p,
          count: p.count + 1,
          lastActiveDate: today, 
          logs: {
            ...p.logs,
            [today]: currentDaily + 1
          }
        };
      }
      return p;
    }));

    setIsPressed(true);
    setTimeout(() => setIsPressed(false), 100);
  }, [activeProjectId]);

  const handleReset = useCallback(() => {
    const today = getTodayString();
    setProjects(prev => prev.map(p => {
      if (p.id === activeProjectId) {
        return { ...p, count: 0, lastActiveDate: today };
      }
      return p;
    }));
    setShowResetConfirm(false);
  }, [activeProjectId]);

  const handleFactoryReset = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(RECENT_NAMES_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem(STATS_START_DATE_KEY);
    
    const today = getTodayString();
    const newDefault: Project = {
      id: generateId(),
      name: '默認計數 (Default)',
      count: 0,
      logs: {},
      createdAt: Date.now(),
      lastActiveDate: today
    };
    
    setProjects([newDefault]);
    setActiveProjectId(newDefault.id);
    setRecentNames([]);
    setStatsStartDate(getSixMonthsAgoString());
    setShowFactoryResetConfirm(false);
    setShowProjectMenu(false);
    alert("已恢復出廠設定，所有資料已清除。");
  };

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = newProjectName.trim();
    if (!trimmedName) return;

    const today = getTodayString();
    const archivedProject = projects.find(p => 
      p.name.trim().toLowerCase() === trimmedName.toLowerCase() && 
      p.lastActiveDate !== today
    );

    if (archivedProject) {
      setProjects(prev => prev.map(p => {
        if (p.id === archivedProject.id) {
          return {
            ...p,
            lastActiveDate: today,
            count: 0
          };
        }
        return p;
      }));
      setActiveProjectId(archivedProject.id);
    } else {
      const newProject: Project = {
        id: generateId(),
        name: trimmedName,
        count: 0,
        logs: {},
        createdAt: Date.now(),
        lastActiveDate: today
      };
      setProjects(prev => [...prev, newProject]);
      setActiveProjectId(newProject.id);
    }
    
    const updatedRecents = [trimmedName, ...recentNames.filter(n => n !== trimmedName)].slice(0, 10);
    setRecentNames(updatedRecents);
    localStorage.setItem(RECENT_NAMES_KEY, JSON.stringify(updatedRecents));

    setNewProjectName('');
    setShowProjectMenu(false);
  };

  const requestDeleteProject = (p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    const today = getTodayString();
    const logDates = Object.keys(p.logs);
    const hasHistory = logDates.some(date => date !== today && p.logs[date] > 0);

    setDeleteTarget({
      type: 'project',
      projectId: p.id,
      name: p.name,
      hasHistory: hasHistory
    });
  };

  const startEditingProject = (p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProjectId(p.id);
    setEditingNameValue(p.name);
  };

  const saveEditingProject = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (editingProjectId && editingNameValue.trim()) {
      const today = getTodayString();
      setProjects(prev => prev.map(p => 
        p.id === editingProjectId ? { ...p, name: editingNameValue.trim(), lastActiveDate: today } : p
      ));
    }
    setEditingProjectId(null);
    setEditingNameValue('');
  };

  const cancelEditingProject = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProjectId(null);
    setEditingNameValue('');
  };

  const visibleProjects = useMemo(() => {
    const todayStr = getTodayString();
    const sorter = (a: Project, b: Project) => {
      if (a.id === activeProjectId) return -1;
      if (b.id === activeProjectId) return 1;
      return a.name.localeCompare(b.name);
    };

    return projects.filter(p => {
      const isForToday = p.lastActiveDate === todayStr;
      const isCurrent = p.id === activeProjectId;
      return isForToday || isCurrent;
    }).sort(sorter);

  }, [projects, activeProjectId]);

  const requestDeleteLog = (projectId: string, date: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTarget({
      type: 'log',
      projectId,
      date
    });
  };

  const executeDelete = () => {
    if (!deleteTarget) return;

    const today = getTodayString();

    if (deleteTarget.type === 'project') {
      const id = deleteTarget.projectId;
      
      if (deleteTarget.hasHistory) {
        setProjects(prev => prev.map(p => {
          if (p.id === id) {
             const newLogs = { ...p.logs };
             delete newLogs[today]; 
             return {
               ...p,
               count: 0,
               lastActiveDate: 'ARCHIVED',
               logs: newLogs
             };
          }
          return p;
        }));

        if (activeProjectId === id) {
          const remainingVisible = projects.filter(p => p.id !== id && p.lastActiveDate === today);
          if (remainingVisible.length > 0) {
            setActiveProjectId(remainingVisible[0].id);
          } else {
             const newDefault: Project = {
              id: generateId(),
              name: '默認計數 (Default)',
              count: 0,
              logs: {},
              createdAt: Date.now(),
              lastActiveDate: today
            };
            setProjects(prev => [...prev, newDefault]);
            setActiveProjectId(newDefault.id);
          }
        }

      } else {
        const remaining = projects.filter(p => p.id !== id);
        if (remaining.length === 0) {
          const newDefault: Project = {
            id: generateId(),
            name: '新項目 (New Item)',
            count: 0,
            logs: {},
            createdAt: Date.now(),
            lastActiveDate: today
          };
          setProjects([newDefault]);
          setActiveProjectId(newDefault.id);
        } else {
          setProjects(remaining);
          if (activeProjectId === id) {
            const nextVisible = remaining.find(p => p.lastActiveDate === today) || remaining[0];
            setActiveProjectId(nextVisible.id);
          }
        }
      }
    } else if (deleteTarget.type === 'log') {
      const { projectId, date } = deleteTarget;
      if (date) {
        setProjects(prev => prev.map(p => {
          if(p.id === projectId) {
            const newLogs = { ...p.logs };
            delete newLogs[date];
            return { ...p, logs: newLogs };
          }
          return p;
        }));
      }
    }
    setDeleteTarget(null);
  };

  // --- Manual Log Logic ---

  // Get unique projects for selector, sorted by newest first, limited to 10
  const uniqueProjectsForSelector = useMemo(() => {
    // 1. Sort all projects by creation date (newest first)
    const sorted = [...projects].sort((a, b) => b.createdAt - a.createdAt);
    
    // 2. Filter unique names
    const seen = new Set<string>();
    const unique: Project[] = [];
    
    for (const p of sorted) {
      const normalized = p.name.trim();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        unique.push(p);
      }
    }
    // 3. Limit to top 10
    return unique.slice(0, 10);
  }, [projects]);

  useEffect(() => {
    if (showManualLog && uniqueProjectsForSelector.length > 0) {
      // Check if current selection is still in the top 10 list
      const isInList = uniqueProjectsForSelector.some(p => p.id === manualLogProjectId);
      if (!manualLogProjectId || !isInList) {
        setManualLogProjectId(uniqueProjectsForSelector[0].id);
      }
    }
  }, [showManualLog, uniqueProjectsForSelector, manualLogProjectId]);

  const handleManualLogSubmit = () => {
    if (!manualLogProjectId || !manualLogCount) return;
    const count = parseInt(manualLogCount, 10);
    if (isNaN(count)) return;

    const today = getTodayString();
    
    setProjects(prev => prev.map(p => {
      if (p.id === manualLogProjectId) {
        const newLogs = { ...p.logs };
        if (count === 0) {
          delete newLogs[manualLogDate];
        } else {
          newLogs[manualLogDate] = count;
        }
        
        // If date is today, also update visual count
        const isToday = manualLogDate === today;
        return {
          ...p,
          logs: newLogs,
          count: isToday ? count : p.count,
          lastActiveDate: isToday ? today : p.lastActiveDate
        };
      }
      return p;
    }));

    setShowManualLog(false);
    setShowStats(true); // Re-open stats modal after submitting
    setManualLogCount('');
    setManualLogDate(getTodayString());
  };

  const handleStatsDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setStatsStartDate(val);
    localStorage.setItem(STATS_START_DATE_KEY, val);
  };


  // --- Stats Calculation ---
  
  const aggregatedStats = useMemo(() => {
    const statsByName: Record<string, { total: number, occurrences: number }> = {};

    projects.forEach(p => {
      const normalizedName = p.name.trim(); 
      if (!statsByName[normalizedName]) {
        statsByName[normalizedName] = { total: 0, occurrences: 0 };
      }
      Object.entries(p.logs).forEach(([date, count]) => {
        if (date >= statsStartDate && (count as number) > 0) {
          statsByName[normalizedName].total += (count as number);
          statsByName[normalizedName].occurrences += 1; 
        }
      });
    });

    return Object.entries(statsByName)
      .map(([name, data]) => ({
        name,
        total: data.total,
        occurrences: data.occurrences
      }))
      .filter(item => item.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [projects, statsStartDate]);

  const historyData = useMemo(() => {
    const allDates = new Set<string>();
    projects.forEach(p => {
      Object.keys(p.logs).forEach(d => {
        if (d >= statsStartDate) {
          allDates.add(d);
        }
      });
    });

    const sortedDates = Array.from(allDates).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

    return sortedDates.map(date => {
      const items = projects
        .filter(p => (p.logs[date] || 0) > 0)
        .map(p => ({ 
          projectId: p.id,
          name: p.name, 
          count: p.logs[date] 
        }));
      
      const totalForDay = items.reduce((sum, item) => sum + item.count, 0);
      if (totalForDay === 0 && items.length === 0) return null;

      return {
        date,
        total: totalForDay,
        items
      };
    }).filter(Boolean) as { date: string, total: number, items: {projectId: string, name: string, count: number}[] }[];
  }, [projects, statsStartDate]);


  return (
    <div className="h-screen w-full flex flex-col bg-slate-950 relative selection:bg-indigo-500 selection:text-white overflow-hidden text-slate-100 font-sans">
      
      {/* Background */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(79,70,229,0.15),rgba(15,23,42,0)_50%)] z-0 pointer-events-none"></div>

      {/* Header */}
      <header className="relative z-10 w-full p-4 pt-6 flex justify-between items-start">
        <button 
          onClick={() => setShowProjectMenu(true)}
          className="group flex flex-col items-start outline-none"
        >
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 ml-1">
            Current Project
          </span>
          <div className="flex items-center gap-3 bg-slate-800/40 backdrop-blur-md border border-slate-700/50 rounded-full pl-4 pr-3 py-2 shadow-lg shadow-black/20 group-hover:bg-slate-800/60 group-hover:border-indigo-500/30 transition-all active:scale-95">
            <h1 className="text-lg font-bold text-slate-100 max-w-[160px] truncate leading-none">
              {activeProject?.name}
            </h1>
            <div className="bg-slate-700/50 rounded-full p-1 text-slate-400 group-hover:text-white transition-colors">
               <ChevronRight size={16} />
            </div>
          </div>
        </button>
        
        <div className="flex gap-2">
          <button 
            onClick={() => setShowStats(true)}
            className="p-3 rounded-full bg-slate-800/80 hover:bg-indigo-900/40 text-slate-300 hover:text-indigo-300 transition-all border border-slate-700 hover:border-indigo-500/30 backdrop-blur-sm shadow-lg shadow-black/20"
          >
            <BarChart3 size={20} />
          </button>
          <button 
            onClick={() => setShowResetConfirm(true)}
            className="p-3 rounded-full bg-slate-800/80 hover:bg-rose-900/20 text-slate-300 hover:text-rose-400 transition-all border border-slate-700 hover:border-rose-500/30 backdrop-blur-sm shadow-lg shadow-black/20"
          >
            <RotateCcw size={20} />
          </button>
        </div>
      </header>

      {/* Main Display Area */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center w-full max-w-md mx-auto px-6 pb-12 gap-8">
        <div className="flex flex-col items-center justify-center w-full mt-auto mb-auto">
          <div className={`
            font-sans tabular-nums font-bold text-white
            select-none leading-none tracking-tighter
            ${(activeProject?.count || 0) > 999 ? 'text-[5rem]' : 'text-[7rem]'}
            drop-shadow-[0_0_15px_rgba(99,102,241,0.15)]
          `}>
            {activeProject?.count || 0}
          </div>
        </div>

        <div className="w-full flex-none flex items-center justify-center pb-8 mt-12">
          <button
            onClick={handleIncrement}
            className={`
              relative group w-64 h-64 sm:w-72 sm:h-72 rounded-full 
              flex items-center justify-center
              transition-transform duration-100 ease-out touch-manipulation
              outline-none focus:ring-4 focus:ring-indigo-500/30
              bg-gradient-to-br from-indigo-500 to-indigo-600
              shadow-[0_20px_50px_-12px_rgba(79,70,229,0.5),inset_0_2px_4px_rgba(255,255,255,0.2)]
              ${isPressed 
                ? 'scale-[0.98] brightness-95' 
                : 'scale-100 hover:brightness-110'
              }
            `}
          >
            <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white/10 to-transparent pointer-events-none"></div>
            <Plus size={88} strokeWidth={3} className="text-white drop-shadow-md" />
          </button>
        </div>
      </main>

      {/* --- Project Menu Modal --- */}
      {showProjectMenu && (
        <div className="absolute inset-0 z-50 bg-slate-950/95 backdrop-blur-xl flex flex-col animate-in fade-in slide-in-from-bottom-5 duration-300">
          <div className="p-5 flex items-center justify-between border-b border-slate-800 bg-slate-900/50">
            <h2 className="text-xl font-bold text-white flex items-center gap-3">
              <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400">
                <Menu size={20} />
              </div>
              今日項目 (Today)
            </h2>
            <button 
              onClick={() => setShowProjectMenu(false)}
              className="p-2 bg-slate-800 rounded-full text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            {visibleProjects.length === 0 && (
              <div className="text-center py-10 animate-in fade-in zoom-in-95 duration-300">
                <div className="inline-flex justify-center items-center w-12 h-12 rounded-full bg-slate-900 mb-3 text-slate-600">
                  <Filter size={20} />
                </div>
                <p className="text-slate-500 text-sm">今日尚無項目</p>
                <p className="text-slate-600 text-xs mt-1">請建立新項目</p>
              </div>
            )}

            {visibleProjects.map(p => (
              <div 
                key={p.id}
                onClick={() => {
                  if (editingProjectId !== p.id) {
                    setActiveProjectId(p.id);
                    setShowProjectMenu(false);
                  }
                }}
                className={`
                  w-full p-4 rounded-xl border flex items-center justify-between transition-all group
                  ${activeProjectId === p.id 
                    ? 'bg-gradient-to-r from-indigo-900/40 to-slate-900/40 border-indigo-500/50 shadow-lg shadow-indigo-900/10' 
                    : 'bg-slate-900/40 border-slate-800 hover:bg-slate-800 hover:border-slate-600'
                  }
                  ${editingProjectId === p.id ? 'border-indigo-400 ring-1 ring-indigo-400 bg-slate-800' : 'cursor-pointer'}
                `}
              >
                <div className="flex-1 mr-4">
                  {editingProjectId === p.id ? (
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <input 
                        type="text" 
                        value={editingNameValue}
                        onChange={(e) => setEditingNameValue(e.target.value)}
                        className="bg-slate-950 text-white rounded-lg px-3 py-2 w-full border border-indigo-500/50 focus:border-indigo-400 outline-none"
                        autoFocus
                      />
                    </div>
                  ) : (
                    <>
                      <div className={`font-bold text-lg mb-1 ${activeProjectId === p.id ? 'text-indigo-300' : 'text-slate-200 group-hover:text-white'}`}>
                        {p.name}
                      </div>
                      <div className="text-xs text-slate-500 font-sans tabular-nums">
                        Count: <span className="text-slate-300">{p.count}</span>
                      </div>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {editingProjectId === p.id ? (
                    <>
                      <button onClick={saveEditingProject} className="p-2 bg-indigo-600 rounded-lg text-white hover:bg-indigo-500 shadow-lg shadow-indigo-900/20">
                        <Save size={18} />
                      </button>
                      <button onClick={cancelEditingProject} className="p-2 bg-slate-700 rounded-lg text-slate-300 hover:bg-slate-600">
                        <X size={18} />
                      </button>
                    </>
                  ) : (
                    <>
                      {activeProjectId === p.id && <Check size={20} className="text-indigo-400 mr-3" />}
                      <button onClick={(e) => startEditingProject(p, e)} className="p-2 hover:bg-slate-700/80 rounded-lg text-slate-500 hover:text-indigo-300 transition-colors">
                          <Pencil size={18} />
                      </button>
                      <button onClick={(e) => requestDeleteProject(p, e)} className="p-2 hover:bg-rose-900/30 rounded-lg text-slate-500 hover:text-rose-400 transition-colors">
                          <Trash2 size={18} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
             
             <button onClick={() => setShowFactoryResetConfirm(true)} className="w-full py-4 text-xs text-rose-800 hover:text-rose-500 flex items-center justify-center gap-2 transition-colors mt-8">
                <Trash size={12} /> ⚠️ 清除所有資料 (Clear All Data)
             </button>
          </div>

          <div className="p-5 border-t border-slate-800 bg-slate-900 pb-8 flex flex-col gap-5 shadow-[0_-10px_40px_rgba(0,0,0,0.3)] z-10">
            <form onSubmit={handleCreateProject} className="flex gap-3">
              <input
                type="text"
                placeholder="輸入新項目名稱..."
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                className="flex-1 bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:bg-slate-800 transition-colors"
              />
              <button 
                type="submit"
                disabled={!newProjectName.trim()}
                className="bg-indigo-600 text-white p-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-500 font-bold shadow-lg shadow-indigo-900/30"
              >
                <PlusCircle size={24} />
              </button>
            </form>

            {recentNames.length > 0 && (
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex items-center gap-2 mb-3 text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                  <Clock size={12} /> 最近使用 (Recently Used)
                </div>
                <div className="flex flex-wrap gap-2">
                  {recentNames.map((name, index) => (
                    <button
                      key={`${name}-${index}`}
                      onClick={() => setNewProjectName(name)}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700/50 text-slate-400 text-sm hover:border-indigo-500/50 hover:text-indigo-300 hover:bg-slate-750 transition-all active:scale-95"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- Stats Modal --- */}
      {showStats && (
        <div className="absolute inset-0 z-50 bg-slate-950 flex flex-col animate-in slide-in-from-bottom duration-300">
           <div className="p-5 flex items-center justify-between border-b border-slate-800 bg-slate-900/50">
             <div className="flex items-center gap-3">
               <button 
                 onClick={() => setShowDateSettings(true)}
                 className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400 hover:bg-indigo-500/30 transition-colors active:scale-95"
                 title="設定統計起始日"
               >
                 <CalendarRange size={20} />
               </button>
               <h2 className="text-xl font-bold text-white">統計紀錄</h2>
             </div>
            
            <div className="flex items-center gap-3">
                <button
                    onClick={() => {
                        setShowStats(false);
                        setShowManualLog(true);
                    }}
                    className="flex items-center gap-2 bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600 hover:text-white px-3 py-2 rounded-lg font-bold transition-all border border-indigo-500/20 text-xs sm:text-sm"
                >
                    <CalendarPlus size={16} />
                    補填紀錄
                </button>
                <button 
                  onClick={() => setShowStats(false)}
                  className="p-2 bg-slate-800 rounded-full text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 transition-colors"
                >
                  <X size={20} />
                </button>
            </div>
          </div>

          <div className="flex border-b border-slate-800 bg-slate-900/30 p-1 mx-4 mt-4 rounded-xl">
            <button 
              onClick={() => setStatsView('overview')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all
                ${statsView === 'overview' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'}`}
            >
              <PieChart size={16} /> 統計總覽
            </button>
            <button 
              onClick={() => setStatsView('history')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all
                ${statsView === 'history' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'}`}
            >
              <List size={16} /> 詳細紀錄
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-12">
            
            {/* VIEW: AGGREGATED OVERVIEW */}
            {statsView === 'overview' && (
               <div className="space-y-4">
                 {aggregatedStats.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                      <div className="p-6 bg-slate-900 rounded-full mb-4">
                        <PieChart size={32} className="opacity-20" />
                      </div>
                      <p className="font-medium">尚無統計數據</p>
                      <p className="text-xs mt-1">請確認日期範圍設定</p>
                    </div>
                 ) : (
                   aggregatedStats.map((item, index) => {
                     const average = item.occurrences > 0 ? (item.total / item.occurrences).toFixed(1).replace(/\.0$/, '') : "0";
                     let rankStyle = "bg-slate-800 text-slate-500";
                     let borderClass = "border-slate-800";
                     if (index === 0) {
                        rankStyle = "bg-yellow-500 text-yellow-950 shadow-[0_0_15px_rgba(234,179,8,0.4)]";
                        borderClass = "border-yellow-500/30";
                     } else if (index === 1) {
                        rankStyle = "bg-slate-300 text-slate-900 shadow-[0_0_15px_rgba(203,213,225,0.3)]";
                        borderClass = "border-slate-400/30";
                     } else if (index === 2) {
                        rankStyle = "bg-orange-700 text-orange-100 shadow-[0_0_15px_rgba(194,65,12,0.3)]";
                        borderClass = "border-orange-700/30";
                     }

                     return (
                     <div key={item.name} className={`bg-slate-900/60 border ${borderClass} p-5 rounded-2xl flex items-center justify-between animate-in fade-in slide-in-from-bottom-2 duration-300`} style={{animationDelay: `${index * 50}ms`}}>
                       <div className="flex items-center gap-4 z-10">
                         <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0 ${rankStyle}`}>
                           {index < 3 ? <Trophy size={14} /> : index + 1}
                         </div>
                         <div className="flex flex-col">
                            <span className="text-white font-bold text-lg leading-tight mb-1">{item.name}</span>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                              <span className="flex items-baseline gap-1">
                                總計：<span className="text-slate-300 font-bold tabular-nums">{item.total}</span>
                              </span>
                              <span className="flex items-baseline gap-1">
                                平均：<span className="text-indigo-400 font-bold tabular-nums">{average}</span>
                              </span>
                            </div>
                         </div>
                       </div>
                       <div className="text-right z-10 pl-2">
                         <div className="font-sans tabular-nums text-2xl font-black text-white">{item.occurrences}</div>
                         <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">天</div>
                       </div>
                     </div>
                   )})
                 )}
                 
                 {/* Stats Date Footer */}
                 <div className="flex flex-col items-center justify-center pt-6 pb-2 opacity-50 hover:opacity-100 transition-opacity">
                    <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">
                      <CalendarRange size={12} />
                      統計起始日 (Start Date)
                    </div>
                    <div className="font-mono text-xs text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                      {statsStartDate.replace(/-/g, '/')}
                    </div>
                 </div>
               </div>
            )}

            {/* VIEW: HISTORY */}
            {statsView === 'history' && (
              <>
                {historyData.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                    <div className="p-6 bg-slate-900 rounded-full mb-4">
                      <Calendar size={32} className="opacity-20" />
                    </div>
                    <p className="font-medium">尚無紀錄</p>
                  </div>
                ) : (
                  <div className="relative">
                     <div className="absolute left-[19px] top-4 bottom-0 w-px bg-slate-800/50 z-0"></div>
                    {historyData.map((dayStat, idx) => (
                      <div key={dayStat.date} className="relative z-10 mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500" style={{animationDelay: `${idx * 50}ms`}}>
                        <div className="flex items-start gap-4 mb-3">
                          <div className="flex-none flex items-center justify-center w-10 h-6 bg-slate-950 z-10">
                             <div className="w-3 h-3 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]"></div>
                          </div>
                          <div className="flex-1 pt-0.5">
                            <div className="text-slate-400 font-bold uppercase tracking-wide text-xs mb-3 flex items-center gap-2">
                              {formatDateDisplay(dayStat.date)}
                            </div>
                            <div className="space-y-2">
                              {dayStat.items.map((item, itemIdx) => (
                                <div key={`${dayStat.date}-${item.projectId}-${itemIdx}`} className="bg-slate-900/60 border border-slate-800/50 p-3 rounded-xl flex justify-between items-center group">
                                  <span className="text-slate-200 font-medium">{item.name}</span>
                                  <div className="flex items-center gap-3">
                                    <span className="font-sans tabular-nums text-indigo-300 font-bold bg-indigo-500/10 px-2.5 py-1 rounded-md text-sm">
                                      {item.count}
                                    </span>
                                    <button 
                                      onClick={(e) => requestDeleteLog(item.projectId, dayStat.date, e)}
                                      className="p-1.5 text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* --- Date Settings Modal --- */}
      {showDateSettings && (
        <div className="absolute inset-0 z-[80] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
           <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-sm shadow-2xl">
             <div className="flex items-center gap-4 mb-6 text-indigo-400">
               <div className="p-3 bg-indigo-500/10 rounded-2xl">
                 <CalendarRange size={24} />
               </div>
               <h2 className="text-xl font-bold text-white">設定統計起始日</h2>
             </div>
             
             <div className="space-y-4 mb-8">
               <div className="space-y-2">
                 <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">選擇日期</label>
                 <input
                   type="date"
                   max={getTodayString()}
                   value={statsStartDate}
                   onChange={handleStatsDateChange}
                   className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-4 text-white outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors [color-scheme:dark]"
                 />
               </div>
               <p className="text-xs text-slate-500 leading-relaxed">
                 統計數據將從此日期開始計算，早於此日期的紀錄將不會顯示在統計列表中。
               </p>
             </div>

             <button
               onClick={() => setShowDateSettings(false)}
               className="w-full py-3.5 rounded-xl font-bold bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-900/20 transition-colors"
             >
               確定
             </button>
           </div>
        </div>
      )}

      {/* --- Manual Log Modal (Dropdown Style) --- */}
      {showManualLog && (
        <div className="absolute inset-0 z-[60] bg-slate-950 flex flex-col animate-in slide-in-from-bottom duration-300">
           {/* Header */}
           <div className="p-5 flex items-center justify-between border-b border-slate-800 bg-slate-900/50">
            <h2 className="text-xl font-bold text-white flex items-center gap-3">
              <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400">
                <CalendarPlus size={20} />
              </div>
              補填/修改紀錄
            </h2>
            <button 
              onClick={() => {
                setShowManualLog(false);
                setShowStats(true); // Return to Stats modal
              }}
              className="p-2 bg-slate-800 rounded-full text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            
            {/* Project Selector (Dropdown) */}
            <div className="space-y-3">
              <label className="text-sm font-bold text-slate-400 ml-1 uppercase tracking-wider">選擇項目</label>
              <div className="relative">
                  <select
                    value={manualLogProjectId}
                    onChange={(e) => setManualLogProjectId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3.5 text-white outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors appearance-none"
                  >
                    {uniqueProjectsForSelector.map(p => (
                        <option key={p.id} value={p.id} className="bg-slate-900 text-white">
                            {p.name}
                        </option>
                    ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                    <ChevronDown size={16} />
                  </div>
              </div>
              <p className="text-[10px] text-slate-500 text-right">
                  僅顯示最近建立的 10 個項目
              </p>
            </div>

            {/* Date Input */}
            <div className="space-y-3">
              <label className="text-sm font-bold text-slate-400 ml-1 uppercase tracking-wider">日期</label>
              <input
                type="date"
                max={getTodayString()}
                value={manualLogDate}
                onChange={(e) => setManualLogDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3.5 text-white outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors [color-scheme:dark]"
              />
            </div>

            {/* Count Input */}
            <div className="space-y-3">
              <label className="text-sm font-bold text-slate-400 ml-1 uppercase tracking-wider">次數</label>
              <input
                type="number"
                pattern="\d*"
                placeholder="輸入數字"
                value={manualLogCount}
                onChange={(e) => setManualLogCount(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3.5 text-xl font-bold text-white outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors placeholder:text-slate-600"
              />
            </div>

            <button
                onClick={handleManualLogSubmit}
                disabled={!manualLogProjectId || manualLogCount === ''}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition-all active:scale-95 disabled:opacity-50 disabled:scale-100 shadow-lg shadow-indigo-900/20 mt-4"
              >
                儲存紀錄
            </button>
          </div>
        </div>
      )}

      {/* --- Delete Confirmation Modal --- */}
      {deleteTarget && (
        <div className="absolute inset-0 z-[70] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center gap-4 mb-4 text-rose-500">
              <div className="p-3 bg-rose-500/10 rounded-2xl">
                {deleteTarget.type === 'project' && deleteTarget.hasHistory ? (
                   <Archive size={24} className="text-indigo-400" />
                ) : (
                   <AlertTriangle size={24} />
                )}
              </div>
              <h2 className="text-xl font-bold text-white">
                {deleteTarget.type === 'project' 
                  ? (deleteTarget.hasHistory ? '封存今日項目' : '刪除項目') 
                  : '刪除紀錄'}
              </h2>
            </div>
            
            <div className="text-slate-400 mb-8 leading-relaxed">
              {deleteTarget.type === 'project' ? (
                deleteTarget.hasHistory ? (
                  <>
                    確定要將 "<span className="text-white font-bold">{deleteTarget.name}</span>" 從今日列表移除嗎？
                    <div className="mt-3 p-3 bg-slate-800/80 border border-indigo-500/30 rounded-xl text-xs text-slate-300 font-medium flex items-start gap-2">
                       <Check size={14} className="text-indigo-400 mt-0.5" />
                       <div>
                        過去的統計資料將會<span className="text-white font-bold">完整保留</span>。
                        <br/><span className="text-slate-500">下次輸入相同名稱即可找回此項目。</span>
                       </div>
                    </div>
                  </>
                ) : (
                  <>
                    確定要刪除 "<span className="text-white font-bold">{deleteTarget.name}</span>" 嗎？
                    <div className="mt-3 p-3 bg-rose-900/20 border border-rose-900/30 rounded-xl text-xs text-rose-300 font-medium">
                      ⚠️ 此項目無歷史紀錄，將會被永久刪除。
                    </div>
                  </>
                )
              ) : (
                <>
                  確定要刪除此筆歷史紀錄嗎？
                  <div className="mt-2 text-xs text-slate-500">僅刪除當日的計數紀錄。</div>
                </>
              )}
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-3.5 px-4 rounded-xl font-bold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
              >
                取消
              </button>
              <button 
                onClick={executeDelete}
                className={`flex-1 py-3.5 px-4 rounded-xl font-bold text-white shadow-lg transition-colors
                  ${deleteTarget.type === 'project' && deleteTarget.hasHistory 
                    ? 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-900/20' 
                    : 'bg-rose-600 hover:bg-rose-500 shadow-rose-900/20'
                  }`}
              >
                {deleteTarget.type === 'project' && deleteTarget.hasHistory ? '確認移除' : '確認刪除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Reset Confirmation Modal --- */}
      {showResetConfirm && (
        <div className="absolute inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center gap-4 mb-4 text-rose-500">
              <div className="p-3 bg-rose-500/10 rounded-2xl">
                <RotateCcw size={24} />
              </div>
              <h2 className="text-xl font-bold text-white">歸零確認</h2>
            </div>
            <p className="text-slate-400 mb-8 leading-relaxed">
              將 "<span className="text-white font-bold">{activeProject?.name}</span>" 目前顯示的數字歸零？
              <br/>
              <span className="text-xs text-slate-500 mt-2 block bg-slate-800/50 p-2 rounded-lg">
                <Check size={12} className="inline mr-1" />
                歷史統計紀錄不會被刪除，請放心。
              </span>
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 py-3.5 px-4 rounded-xl font-bold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
              >
                取消
              </button>
              <button 
                onClick={handleReset}
                className="flex-1 py-3.5 px-4 rounded-xl font-bold bg-rose-600 text-white hover:bg-rose-500 shadow-lg shadow-rose-900/20 transition-colors"
              >
                確認歸零
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Factory Reset Confirmation Modal --- */}
      {showFactoryResetConfirm && (
        <div className="absolute inset-0 z-[60] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center gap-4 mb-4 text-rose-500">
              <div className="p-3 bg-rose-500/10 rounded-2xl">
                <AlertTriangle size={24} />
              </div>
              <h2 className="text-xl font-bold text-white">恢復出廠設定</h2>
            </div>
            
            <div className="text-slate-400 mb-8 leading-relaxed">
              確定要清除所有資料並重置嗎？
              <div className="mt-3 p-3 bg-rose-900/20 border border-rose-900/30 rounded-xl text-xs text-rose-300 font-medium">
                ⚠️ 此動作將永久刪除「所有」專案、計數紀錄及常用名稱，且無法復原。
              </div>
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => setShowFactoryResetConfirm(false)}
                className="flex-1 py-3.5 px-4 rounded-xl font-bold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
              >
                取消
              </button>
              <button 
                onClick={handleFactoryReset}
                className="flex-1 py-3.5 px-4 rounded-xl font-bold bg-rose-600 text-white hover:bg-rose-500 shadow-lg shadow-rose-900/20 transition-colors"
              >
                確認重置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;