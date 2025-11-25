import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  RotateCcw, 
  Plus, 
  Minus, 
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
  Undo2,
  Redo2,
  Trash
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
  const date = new Date(dateStr);
  
  if (dateStr === today) return '今天 (Today)';
  
  return new Intl.DateTimeFormat('zh-TW', { 
    weekday: 'short', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  }).format(date);
};

// Returns a date string for 6 months ago
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
          console.log("Migrating data from legacy storage...");
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
      // Check if we have any projects for 'today'
      const hasProjectsForToday = loadedProjects.some(p => p.lastActiveDate === todayStr);

      if (!hasProjectsForToday) {
        // If today is empty, find the most recent active date from history
        const allDates = new Set<string>();
        loadedProjects.forEach(p => Object.keys(p.logs).forEach(d => allDates.add(d)));
        loadedProjects.forEach(p => allDates.add(p.lastActiveDate)); // Also check lastActiveDate itself
        
        // Sort descending to find latest
        const sortedDates = Array.from(allDates).sort().reverse();
        const latestDate = sortedDates.find(d => d < todayStr);

        if (latestDate) {
          // Bring forward projects from the latest date to today
          loadedProjects = loadedProjects.map(p => {
            // If project was active on the latest date, move it to today's list
            if (p.lastActiveDate === latestDate || (p.logs[latestDate] || 0) > 0) {
              // RESET COUNT TO 0 FOR NEW DAY, but keep logs history
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
      if (saved) {
        return JSON.parse(saved);
      }
      return [];
    } catch (e) {
      return [];
    }
  });

  const [activeProjectId, setActiveProjectId] = useState<string>(() => {
    return projects[0]?.id || '';
  });

  // Undo/Redo History State
  const [history, setHistory] = useState<Project[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const [isPressed, setIsPressed] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showFactoryResetConfirm, setShowFactoryResetConfirm] = useState(false);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  
  // Stats State
  const [showStats, setShowStats] = useState(false);
  const [statsView, setStatsView] = useState<'overview' | 'history'>('overview');

  const [newProjectName, setNewProjectName] = useState('');

  // Editing state
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');

  // Deletion Confirmation State
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'project' | 'log', projectId: string, date?: string, name?: string } | null>(null);

  // --- Derived State ---

  const activeProject = projects.find(p => p.id === activeProjectId) || projects[0];

  useEffect(() => {
    // Safety check: if active project is deleted or doesn't exist, switch to first available
    if (!activeProject && projects.length > 0) {
      setActiveProjectId(projects[0].id);
    } else if (projects.length === 0) {
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
    }
  }, [activeProject, projects]);

  // Seed recent names from existing projects if empty
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

  // --- History (Undo/Redo) Logic ---
  
  const saveToHistory = (currentProjects: Project[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(JSON.parse(JSON.stringify(currentProjects))); // Deep copy
    
    // Limit history size to 20 steps to save memory
    if (newHistory.length > 20) {
      newHistory.shift();
    } else {
      setHistoryIndex(newHistory.length - 1);
    }
    setHistory(newHistory);
  };

  const handleUndo = () => {
    if (historyIndex >= 0) {
      const previousState = history[historyIndex];
      // Save CURRENT state to history before undoing, so we can Redo
      if (historyIndex === history.length - 1) {
         // This is the first undo action, we need to make sure the "future" (current state before undo) is preserved
         // But actually, standard undo/redo implementation usually pushes current state to stack *before* modification.
         // Simplified approach: We treat 'history' as the stack of *past* states.
         // When we Undo, we move pointer back. 
      }
      
      setProjects(previousState);
      setHistoryIndex(prev => prev - 1);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      const nextState = history[nextIndex];
      setProjects(nextState);
      setHistoryIndex(nextIndex);
    }
  };
  
  // Wrapper to capture state before changes
  const updateProjectsWithHistory = (updater: (prev: Project[]) => Project[]) => {
    // 1. Push current state to history (cutting off any redo future)
    const currentHistory = history.slice(0, historyIndex + 1);
    currentHistory.push(projects);
    if (currentHistory.length > 20) currentHistory.shift();
    
    setHistory(currentHistory);
    setHistoryIndex(currentHistory.length - 1);

    // 2. Update state
    setProjects(updater);
  };

  // --- Handlers ---

  const handleIncrement = useCallback(() => {
    const today = getTodayString();
    
    updateProjectsWithHistory(prev => prev.map(p => {
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
  }, [activeProjectId, history, historyIndex, projects]); // Deps updated for history wrapper

  const handleDecrement = useCallback(() => {
    const today = getTodayString();

    updateProjectsWithHistory(prev => prev.map(p => {
      if (p.id === activeProjectId) {
        const newCount = Math.max(0, p.count - 1);
        const currentDaily = p.logs[today] || 0;
        const newDaily = Math.max(0, currentDaily - 1);
        
        return {
          ...p,
          count: newCount,
          lastActiveDate: today,
          logs: {
            ...p.logs,
            [today]: newDaily
          }
        };
      }
      return p;
    }));
  }, [activeProjectId, history, historyIndex, projects]);

  const handleReset = useCallback(() => {
    const today = getTodayString();
    
    updateProjectsWithHistory(prev => prev.map(p => {
      if (p.id === activeProjectId) {
        return { ...p, count: 0, lastActiveDate: today };
      }
      return p;
    }));
    setShowResetConfirm(false);
  }, [activeProjectId, history, historyIndex, projects]);

  const handleFactoryReset = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(RECENT_NAMES_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    
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
    setHistory([]);
    setHistoryIndex(-1);
    setShowFactoryResetConfirm(false);
    setShowProjectMenu(false);
    alert("已恢復出廠設定，所有資料已清除。");
  };

  // Project Management

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = newProjectName.trim();
    if (!trimmedName) return;

    const newProject: Project = {
      id: generateId(),
      name: trimmedName,
      count: 0,
      logs: {},
      createdAt: Date.now(),
      lastActiveDate: getTodayString()
    };

    updateProjectsWithHistory(prev => [...prev, newProject]);
    setActiveProjectId(newProject.id);
    
    const updatedRecents = [trimmedName, ...recentNames.filter(n => n !== trimmedName)].slice(0, 10);
    setRecentNames(updatedRecents);
    localStorage.setItem(RECENT_NAMES_KEY, JSON.stringify(updatedRecents));

    setNewProjectName('');
    setShowProjectMenu(false);
  };

  const requestDeleteProject = (p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTarget({
      type: 'project',
      projectId: p.id,
      name: p.name
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
      updateProjectsWithHistory(prev => prev.map(p => 
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

  // Filter Projects for List
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


  // Stats Management

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

    // Use updateProjectsWithHistory to wrap the delete action
    const currentHistory = history.slice(0, historyIndex + 1);
    currentHistory.push(projects);
    if (currentHistory.length > 20) currentHistory.shift();
    setHistory(currentHistory);
    setHistoryIndex(currentHistory.length - 1);

    if (deleteTarget.type === 'project') {
      const id = deleteTarget.projectId;
      const remaining = projects.filter(p => p.id !== id);
      const today = getTodayString();
      
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
          setActiveProjectId(remaining[0].id);
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

  // --- Stats Calculation ---
  
  const sixMonthsAgoStr = useMemo(() => getSixMonthsAgoString(), []);

  const aggregatedStats = useMemo(() => {
    const statsByName: Record<string, { total: number, occurrences: number }> = {};

    projects.forEach(p => {
      const normalizedName = p.name.trim(); 
      
      if (!statsByName[normalizedName]) {
        statsByName[normalizedName] = { total: 0, occurrences: 0 };
      }

      Object.entries(p.logs).forEach(([date, count]) => {
        if (date >= sixMonthsAgoStr && (count as number) > 0) {
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
  }, [projects, sixMonthsAgoStr]);

  const historyData = useMemo(() => {
    const allDates = new Set<string>();
    projects.forEach(p => {
      Object.keys(p.logs).forEach(d => {
        if (d >= sixMonthsAgoStr) {
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
  }, [projects, sixMonthsAgoStr]);


  return (
    <div className="h-screen w-full flex flex-col bg-slate-950 relative selection:bg-indigo-500 selection:text-white overflow-hidden text-slate-100 font-sans">
      
      {/* Background Gradient & Pattern */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(79,70,229,0.15),rgba(15,23,42,0)_50%)] z-0 pointer-events-none"></div>
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-[0.03] z-0 pointer-events-none"></div>

      {/* Header */}
      <header className="relative z-10 w-full p-4 pt-6 flex justify-between items-start">
        {/* Project Selector Trigger */}
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
           {/* Undo/Redo Group */}
          <div className="flex mr-2 bg-slate-800/80 rounded-full border border-slate-700 backdrop-blur-sm shadow-lg shadow-black/20">
            <button 
              onClick={handleUndo}
              disabled={historyIndex < 0}
              className="p-3 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors rounded-l-full border-r border-slate-700"
              aria-label="Undo"
            >
              <Undo2 size={20} />
            </button>
            <button 
              onClick={handleRedo}
              disabled={historyIndex >= history.length - 1} // No redo available if at latest state
              className="p-3 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors rounded-r-full"
              aria-label="Redo"
            >
              <Redo2 size={20} />
            </button>
          </div>

          {/* Stats Button */}
          <button 
            onClick={() => setShowStats(true)}
            className="p-3 rounded-full bg-slate-800/80 hover:bg-indigo-900/40 text-slate-300 hover:text-indigo-300 transition-all border border-slate-700 hover:border-indigo-500/30 backdrop-blur-sm shadow-lg shadow-black/20"
            aria-label="Statistics"
          >
            <BarChart3 size={20} />
          </button>

          {/* Reset Button */}
          <button 
            onClick={() => setShowResetConfirm(true)}
            className="p-3 rounded-full bg-slate-800/80 hover:bg-rose-900/20 text-slate-300 hover:text-rose-400 transition-all border border-slate-700 hover:border-rose-500/30 backdrop-blur-sm shadow-lg shadow-black/20"
            aria-label="Reset"
          >
            <RotateCcw size={20} />
          </button>
        </div>
      </header>

      {/* Main Display Area */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center w-full max-w-md mx-auto px-6 pb-12 gap-8">
        
        {/* Number Display */}
        <div className={`
          flex flex-col items-center justify-center w-full mt-auto mb-auto
        `}>
          <div className={`
            font-sans tabular-nums font-bold text-white
            select-none leading-none tracking-tighter
            ${(activeProject?.count || 0) > 999 ? 'text-[5rem]' : 'text-[7rem]'}
            drop-shadow-[0_0_15px_rgba(99,102,241,0.15)]
          `}>
            {activeProject?.count || 0}
          </div>
        </div>

        {/* Action Buttons Row */}
        <div className="w-full flex items-center justify-center gap-8 mb-4">
           {/* Minus Button */}
           <button 
            onClick={handleDecrement}
            className="p-5 rounded-full bg-slate-800/50 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors border border-slate-700 active:bg-slate-800 shadow-xl"
            aria-label="Decrease"
          >
            <Minus size={28} />
          </button>
        </div>

        {/* The Big Button */}
        <div className="w-full flex-none flex items-center justify-center pb-8">
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
            {/* Button Inner Glow/Gradient */}
            <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white/10 to-transparent pointer-events-none"></div>
            
            {/* Icon */}
            <Plus 
              size={88} 
              strokeWidth={3}
              className="text-white drop-shadow-md"
            />
          </button>
        </div>
      </main>

      {/* --- Project Menu Modal (Drawer style) --- */}
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
              onClick={() => {
                setShowProjectMenu(false);
              }}
              className="p-2 bg-slate-800 rounded-full text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* List Content */}
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
                    <div 
                      className="flex items-center gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
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
                      <button 
                        onClick={saveEditingProject}
                        className="p-2 bg-indigo-600 rounded-lg text-white hover:bg-indigo-500 shadow-lg shadow-indigo-900/20"
                      >
                        <Save size={18} />
                      </button>
                      <button 
                        onClick={cancelEditingProject}
                        className="p-2 bg-slate-700 rounded-lg text-slate-300 hover:bg-slate-600"
                      >
                        <X size={18} />
                      </button>
                    </>
                  ) : (
                    <>
                      {activeProjectId === p.id && <Check size={20} className="text-indigo-400 mr-3" />}
                      
                      <button 
                          onClick={(e) => startEditingProject(p, e)}
                          className="p-2 hover:bg-slate-700/80 rounded-lg text-slate-500 hover:text-indigo-300 transition-colors"
                      >
                          <Pencil size={18} />
                      </button>
                      <button 
                          onClick={(e) => requestDeleteProject(p, e)}
                          className="p-2 hover:bg-rose-900/30 rounded-lg text-slate-500 hover:text-rose-400 transition-colors"
                      >
                          <Trash2 size={18} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
             
             {/* Factory Reset Button */}
             <button 
                onClick={() => setShowFactoryResetConfirm(true)}
                className="w-full py-4 text-xs text-rose-800 hover:text-rose-500 flex items-center justify-center gap-2 transition-colors mt-8"
             >
                <Trash size={12} />
                ⚠️ 清除所有資料 (Clear All Data)
             </button>
          </div>

          <div className="p-5 border-t border-slate-800 bg-slate-900 pb-8 flex flex-col gap-5 shadow-[0_-10px_40px_rgba(0,0,0,0.3)] z-10">
            {/* New Project Input */}
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

            {/* Recent Names Chips */}
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

      {/* --- Statistics Modal --- */}
      {showStats && (
        <div className="absolute inset-0 z-50 bg-slate-950 flex flex-col animate-in slide-in-from-bottom duration-300">
           {/* Header */}
           <div className="p-5 flex items-center justify-between border-b border-slate-800 bg-slate-900/50">
            <h2 className="text-xl font-bold text-white flex items-center gap-3">
              <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400">
                <BarChart3 size={20} />
              </div>
              統計紀錄
            </h2>
            <button 
              onClick={() => setShowStats(false)}
              className="p-2 bg-slate-800 rounded-full text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Tab Switcher */}
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
          
          <div className="px-4 py-3 text-xs text-slate-500 text-center font-medium tracking-wide">
            資料範圍：最近 6 個月 (Last 6 Months)
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-12">
            
            {/* VIEW: AGGREGATED OVERVIEW */}
            {statsView === 'overview' && (
               <div className="space-y-4">
                 {aggregatedStats.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                      <div className="p-6 bg-slate-900 rounded-full mb-4">
                        <PieChart size={32} className="opacity-20" />
                      </div>
                      <p className="font-medium">尚無半年內數據</p>
                    </div>
                 ) : (
                   aggregatedStats.map((item, index) => {
                     const average = item.occurrences > 0 ? (item.total / item.occurrences).toFixed(1).replace(/\.0$/, '') : "0";
                     
                     // Rank Styling
                     let rankStyle = "bg-slate-800 text-slate-500";
                     let borderClass = "border-slate-800";
                     let glowClass = "";
                     if (index === 0) {
                        rankStyle = "bg-yellow-500 text-yellow-950 shadow-[0_0_15px_rgba(234,179,8,0.4)]";
                        borderClass = "border-yellow-500/30";
                        glowClass = "shadow-[inset_0_0_20px_rgba(234,179,8,0.05)]";
                     } else if (index === 1) {
                        rankStyle = "bg-slate-300 text-slate-900 shadow-[0_0_15px_rgba(203,213,225,0.3)]";
                        borderClass = "border-slate-400/30";
                     } else if (index === 2) {
                        rankStyle = "bg-orange-700 text-orange-100 shadow-[0_0_15px_rgba(194,65,12,0.3)]";
                        borderClass = "border-orange-700/30";
                     }

                     return (
                     <div key={item.name} className={`bg-slate-900/60 border ${borderClass} p-5 rounded-2xl flex items-center justify-between animate-in fade-in slide-in-from-bottom-2 duration-300 relative overflow-hidden ${glowClass}`} style={{animationDelay: `${index * 50}ms`}}>
                       
                       {/* Left: Name and Total/Average */}
                       <div className="flex items-center gap-4 z-10">
                         <div className={`
                           w-8 h-8 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0 ${rankStyle}
                         `}>
                           {index < 3 ? <Trophy size={14} /> : index + 1}
                         </div>
                         <div className="flex flex-col">
                            <span className="text-white font-bold text-lg leading-tight mb-1">{item.name}</span>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                              <span className="flex items-baseline gap-1">
                                總計次數：<span className="text-slate-300 font-bold font-sans tabular-nums text-sm">{item.total}</span>
                              </span>
                              <span className="flex items-baseline gap-1">
                                平均每次：<span className="text-indigo-400 font-bold font-sans tabular-nums text-sm">{average}</span>
                              </span>
                            </div>
                         </div>
                       </div>
                       
                       {/* Right: Recorded Times (Big Number) */}
                       <div className="text-right z-10 pl-2">
                         <div className="font-sans tabular-nums text-2xl font-black text-white">
                           {item.occurrences}
                         </div>
                         <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">
                           紀錄次數
                         </div>
                       </div>
                     </div>
                   )})
                 )}
               </div>
            )}

            {/* VIEW: DAILY HISTORY */}
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
                     {/* Continuous Timeline Line */}
                     <div className="absolute left-[19px] top-4 bottom-0 w-px bg-slate-800/50 z-0"></div>

                    {historyData.map((dayStat, idx) => (
                      <div key={dayStat.date} className="relative z-10 mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500" style={{animationDelay: `${idx * 50}ms`}}>
                        
                        <div className="flex items-start gap-4 mb-3">
                          {/* Date Node (Simple Dot) */}
                          <div className="flex-none flex items-center justify-center w-10 h-6 bg-slate-950 z-10">
                             <div className="w-3 h-3 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]"></div>
                          </div>
                          
                          {/* Content */}
                          <div className="flex-1 pt-0.5">
                            <div className="text-slate-400 font-bold uppercase tracking-wide text-xs mb-3 flex items-center gap-2">
                              {formatDateDisplay(dayStat.date)}
                            </div>

                            <div className="space-y-2">
                              {dayStat.items.map((item, itemIdx) => (
                                <div key={`${dayStat.date}-${item.projectId}-${itemIdx}`} className="bg-slate-900/60 border border-slate-800/50 p-3 rounded-xl flex justify-between items-center group hover:bg-slate-800/60 transition-colors">
                                  <span className="text-slate-200 font-medium">{item.name}</span>
                                  <div className="flex items-center gap-3">
                                    <span className="font-sans tabular-nums text-indigo-300 font-bold bg-indigo-500/10 px-2.5 py-1 rounded-md text-sm">
                                      {item.count}
                                    </span>
                                    <button 
                                      onClick={(e) => requestDeleteLog(item.projectId, dayStat.date, e)}
                                      className="p-1.5 text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                                      aria-label="Delete record"
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

      {/* --- Delete Confirmation Modal (Custom) --- */}
      {deleteTarget && (
        <div className="absolute inset-0 z-[70] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center gap-4 mb-4 text-rose-500">
              <div className="p-3 bg-rose-500/10 rounded-2xl">
                <AlertTriangle size={24} />
              </div>
              <h2 className="text-xl font-bold text-white">
                {deleteTarget.type === 'project' ? '刪除項目' : '刪除紀錄'}
              </h2>
            </div>
            
            <div className="text-slate-400 mb-8 leading-relaxed">
              {deleteTarget.type === 'project' ? (
                <>
                  確定要刪除 "<span className="text-white font-bold">{deleteTarget.name}</span>" 嗎？
                  <div className="mt-3 p-3 bg-rose-900/20 border border-rose-900/30 rounded-xl text-xs text-rose-300 font-medium">
                    ⚠️ 此動作將永久刪除該項目及其所有歷史紀錄，無法復原。
                  </div>
                </>
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
                className="flex-1 py-3.5 px-4 rounded-xl font-bold bg-rose-600 text-white hover:bg-rose-500 shadow-lg shadow-rose-900/20 transition-colors"
              >
                確認刪除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;