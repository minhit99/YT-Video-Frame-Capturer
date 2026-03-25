/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useCallback, ChangeEvent, MouseEvent } from 'react';
import { Upload, Play, Pause, Camera, Trash2, Download, Video, ChevronRight, ChevronLeft, Loader2, Eye, X, ArrowUpAZ, ArrowDownAZ, HelpCircle, Sun, Moon, Palette, Settings, Globe } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import JSZip from 'jszip';
import { get, set, del } from 'idb-keyval';
import { translations, languages, LanguageCode } from './translations';

interface CapturedFrame {
  id: string;
  timestamp: number;
  dataUrl: string;
  index: number;
  captureOrder: number; // To sort by "Recently Captured"
}

type SortBy = 'timeline' | 'recent';
type SortOrder = 'asc' | 'desc';
type Theme = 'dark' | 'light' | 'custom';

export default function App() {
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [capturedFrames, setCapturedFrames] = useState<CapturedFrame[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isZipping, setIsZipping] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [previewFrame, setPreviewFrame] = useState<CapturedFrame | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>('timeline');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [lastCapturedId, setLastCapturedId] = useState<string | null>(null);
  const [showFlash, setShowFlash] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [lastVideoName, setLastVideoName] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [showDownloadConfirmModal, setShowDownloadConfirmModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [theme, setTheme] = useState<Theme>('dark');
  const [customAccent, setCustomAccent] = useState('#8b5cf6');
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [language, setLanguage] = useState<LanguageCode>('en');
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const galleryRef = useRef<HTMLDivElement>(null);

  // Load saved data on mount
  useEffect(() => {
    const restoreSession = async () => {
      try {
        // Restore preferences
        const savedSortBy = localStorage.getItem('sortBy') as SortBy;
        const savedSortOrder = localStorage.getItem('sortOrder') as SortOrder;
        const savedVideoName = localStorage.getItem('lastVideoName');
        const savedTheme = localStorage.getItem('theme') as Theme;
        const savedAccent = localStorage.getItem('customAccent');
        const savedLanguage = localStorage.getItem('language') as LanguageCode;
        
        if (savedSortBy) setSortBy(savedSortBy);
        if (savedSortOrder) setSortOrder(savedSortOrder);
        if (savedVideoName) setLastVideoName(savedVideoName);
        if (savedTheme) setTheme(savedTheme);
        if (savedAccent) setCustomAccent(savedAccent);
        if (savedLanguage) setLanguage(savedLanguage);

        // Restore frames from IndexedDB
        const savedFrames = await get<CapturedFrame[]>('capturedFrames');
        if (savedFrames) {
          setCapturedFrames(savedFrames);
        }
      } catch (error) {
        console.error('Failed to restore session:', error);
      } finally {
        setIsRestoring(false);
      }
    };

    restoreSession();
  }, []);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    
    if (theme === 'custom') {
      document.documentElement.style.setProperty('--custom-accent', customAccent);
      // Generate a lighter version for secondary accent
      const r = parseInt(customAccent.slice(1, 3), 16);
      const g = parseInt(customAccent.slice(3, 5), 16);
      const b = parseInt(customAccent.slice(5, 7), 16);
      const lightAccent = `rgba(${r}, ${g}, ${b}, 0.6)`;
      document.documentElement.style.setProperty('--custom-accent-light', lightAccent);
      localStorage.setItem('customAccent', customAccent);
    } else {
      document.documentElement.style.removeProperty('--custom-accent');
      document.documentElement.style.removeProperty('--custom-accent-light');
    }
  }, [theme, customAccent]);

  // Save frames to IndexedDB whenever they change
  useEffect(() => {
    if (!isRestoring) {
      set('capturedFrames', capturedFrames);
    }
  }, [capturedFrames, isRestoring]);

  // Save preferences to localStorage
  useEffect(() => {
    localStorage.setItem('sortBy', sortBy);
    localStorage.setItem('sortOrder', sortOrder);
    localStorage.setItem('language', language);
  }, [sortBy, sortOrder, language]);

  // Translation helper
  const t = (key: keyof typeof translations['en'], params?: Record<string, string | number>) => {
    let text = translations[language][key] || translations['en'][key] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, String(v));
      });
    }
    return text;
  };

  // Handle video upload
  const processNewFile = (file: File, keepFrames = false) => {
    const url = URL.createObjectURL(file);
    setVideoSrc(url);
    setLastVideoName(file.name);
    localStorage.setItem('lastVideoName', file.name);
    if (!keepFrames) {
      setCapturedFrames([]);
      del('capturedFrames');
    }
    setIsPlaying(false);
    setPendingFile(null);
    setShowResumeModal(false);
  };

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Prevent uploading the same video if it's already active
      if (videoSrc && file.name === lastVideoName) {
        event.target.value = '';
        return;
      }

      setPendingFile(file);
      
      // If it's the first upload after opening and it matches the previous video,
      // prioritize the resume session popup over the download confirmation.
      if (!videoSrc && file.name === lastVideoName && capturedFrames.length > 0) {
        setShowResumeModal(true);
      } else if (capturedFrames.length > 0) {
        setShowDownloadConfirmModal(true);
      } else {
        processNewFile(file);
      }
    }
    // Reset input value to allow uploading same file again if needed
    event.target.value = '';
  };

  const handleDownloadAndContinue = async () => {
    await downloadAllFrames();
    proceedAfterDownload();
  };

  const handleDiscardAndContinue = () => {
    proceedAfterDownload();
  };

  const proceedAfterDownload = () => {
    setShowDownloadConfirmModal(false);
    if (pendingFile) {
      if (capturedFrames.length > 0 && pendingFile.name === lastVideoName) {
        setShowResumeModal(true);
      } else {
        processNewFile(pendingFile);
      }
    }
  };

  // Capture current frame
  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas) {
      const context = canvas.getContext('2d');
      if (context) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const dataUrl = canvas.toDataURL('image/png');
        const newId = crypto.randomUUID();
        
        // Visual feedback
        setShowFlash(true);
        setTimeout(() => setShowFlash(false), 150);
        setLastCapturedId(newId);
        setTimeout(() => setLastCapturedId(null), 2000); // Highlight for 2 seconds

        setCapturedFrames(prev => {
          const newFrame: CapturedFrame = {
            id: newId,
            timestamp: video.currentTime,
            dataUrl: dataUrl,
            index: 0, // Will be recalculated
            captureOrder: Date.now(),
          };
          
          // Re-calculate indices based on timeline position
          const allFrames = [...prev, newFrame].sort((a, b) => a.timestamp - b.timestamp);
          return allFrames.map((frame, i) => ({
            ...frame,
            index: i + 1
          }));
        });
      }
    }
  }, []);

  useEffect(() => {
    if (lastCapturedId) {
      const element = document.getElementById(`frame-${lastCapturedId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [lastCapturedId]);

  // Keyboard listener for controls
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!videoSrc) return;

      const seekAmount = 1 * playbackRate;

      if (event.key === 'Enter') {
        captureFrame();
      } else if (event.key === 'ArrowLeft') {
        if (videoRef.current) {
          videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - seekAmount);
        }
      } else if (event.key === 'ArrowRight') {
        if (videoRef.current) {
          videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + seekAmount);
        }
      } else if (event.key === ' ') {
        event.preventDefault(); // Prevent page scroll
        togglePlay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [videoSrc, captureFrame, duration, isPlaying, playbackRate]);

  // Video event handlers
  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      videoRef.current.playbackRate = playbackRate;
    }
  };

  const handleSeek = (e: MouseEvent<HTMLDivElement>) => {
    if (progressBarRef.current && videoRef.current && duration > 0) {
      const rect = progressBarRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, x / rect.width));
      const seekTime = percentage * duration;
      videoRef.current.currentTime = seekTime;
      setCurrentTime(seekTime);
    }
  };

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  const deleteFrame = (id: string) => {
    setCapturedFrames(prev => {
      const filtered = prev.filter(frame => frame.id !== id);
      // Re-index after deletion to keep sequence
      return filtered.map((frame, i) => ({
        ...frame,
        index: i + 1
      }));
    });
  };

  const downloadFrame = (frame: CapturedFrame) => {
    const link = document.createElement('a');
    link.href = frame.dataUrl;
    
    // Format: F001_00-00.01
    const indexStr = frame.index.toString().padStart(3, '0');
    const minutes = Math.floor(frame.timestamp / 60);
    const seconds = Math.floor(frame.timestamp % 60);
    const milliseconds = Math.floor((frame.timestamp % 1) * 100);
    
    const timeStr = `${minutes.toString().padStart(2, '0')}-${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
    
    link.download = `F${indexStr}_${timeStr}.png`;
    link.click();
  };

  const downloadAllFrames = async () => {
    if (capturedFrames.length === 0) return;
    
    setIsZipping(true);
    try {
      const zip = new JSZip();
      
      capturedFrames.forEach((frame) => {
        // Extract base64 data from dataUrl (data:image/png;base64,...)
        const base64Data = frame.dataUrl.split(',')[1];
        
        // Format filename
        const indexStr = frame.index.toString().padStart(3, '0');
        const minutes = Math.floor(frame.timestamp / 60);
        const seconds = Math.floor(frame.timestamp % 60);
        const milliseconds = Math.floor((frame.timestamp % 1) * 100);
        const timeStr = `${minutes.toString().padStart(2, '0')}-${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
        const fileName = `F${indexStr}_${timeStr}.png`;
        
        zip.file(fileName, base64Data, { base64: true });
      });
      
      const content = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `frames-capture-${new Date().getTime()}.zip`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      console.error('Error creating zip:', error);
    } finally {
      setIsZipping(false);
    }
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    const milliseconds = Math.floor((time % 1) * 100);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary font-sans selection:bg-accent-primary/30 transition-colors duration-300">
      {/* Header */}
      <header className="border-b border-border-primary bg-bg-secondary/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-accent-primary rounded-lg flex items-center justify-center shadow-lg shadow-accent-primary/20">
              <Video className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight">{t('title')}</h1>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Language Selector */}
            <div className="relative">
              <button 
                onClick={() => setShowLanguageMenu(!showLanguageMenu)}
                className="w-10 h-10 flex items-center justify-center bg-bg-primary/50 hover:bg-bg-primary border border-border-primary rounded-full transition-all text-text-secondary hover:text-text-primary"
                title={t('selectLanguage')}
              >
                <Globe className="w-5 h-5" />
              </button>

              <AnimatePresence>
                {showLanguageMenu && (
                  <>
                    <div 
                      className="fixed inset-0 z-40" 
                      onClick={() => setShowLanguageMenu(false)} 
                    />
                    <motion.div 
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute right-0 mt-2 w-48 bg-bg-secondary border border-border-primary rounded-2xl shadow-2xl p-2 z-50 max-h-[70vh] overflow-y-auto custom-scrollbar"
                    >
                      <div className="px-3 py-2 text-xs font-bold text-text-secondary uppercase tracking-wider">{t('selectLanguage')}</div>
                      {languages.map((lang) => (
                        <button 
                          key={lang.code}
                          onClick={() => { setLanguage(lang.code as LanguageCode); setShowLanguageMenu(false); }}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-colors ${language === lang.code ? 'bg-accent-primary/10 text-accent-primary' : 'hover:bg-bg-primary text-text-secondary'}`}
                        >
                          <span className="text-lg">{lang.flag}</span>
                          <span className="text-sm font-medium">{lang.name}</span>
                        </button>
                      ))}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            <div className="relative">
              <button 
                onClick={() => setShowThemeMenu(!showThemeMenu)}
                className="w-10 h-10 flex items-center justify-center bg-bg-primary/50 hover:bg-bg-primary border border-border-primary rounded-full transition-all text-text-secondary hover:text-text-primary"
                title={t('selectTheme')}
              >
                {theme === 'dark' ? <Moon className="w-5 h-5" /> : theme === 'light' ? <Sun className="w-5 h-5" /> : <Palette className="w-5 h-5" />}
              </button>

              <AnimatePresence>
                {showThemeMenu && (
                  <>
                    <div 
                      className="fixed inset-0 z-40" 
                      onClick={() => setShowThemeMenu(false)} 
                    />
                    <motion.div 
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute right-0 mt-2 w-56 bg-bg-secondary border border-border-primary rounded-2xl shadow-2xl p-2 z-50"
                    >
                      <div className="px-3 py-2 text-xs font-bold text-text-secondary uppercase tracking-wider">{t('selectTheme')}</div>
                      <button 
                        onClick={() => { setTheme('light'); setShowThemeMenu(false); }}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-colors ${theme === 'light' ? 'bg-accent-primary/10 text-accent-primary' : 'hover:bg-bg-primary text-text-secondary'}`}
                      >
                        <Sun className="w-4 h-4" />
                        <span className="text-sm font-medium">{t('lightMode')}</span>
                      </button>
                      <button 
                        onClick={() => { setTheme('dark'); setShowThemeMenu(false); }}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-colors ${theme === 'dark' ? 'bg-accent-primary/10 text-accent-primary' : 'hover:bg-bg-primary text-text-secondary'}`}
                      >
                        <Moon className="w-4 h-4" />
                        <span className="text-sm font-medium">{t('darkMode')}</span>
                      </button>
                      <button 
                        onClick={() => { setTheme('custom'); setShowThemeMenu(false); }}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-colors ${theme === 'custom' ? 'bg-accent-primary/10 text-accent-primary' : 'hover:bg-bg-primary text-text-secondary'}`}
                      >
                        <Palette className="w-4 h-4" />
                        <span className="text-sm font-medium">{t('customAccent')}</span>
                      </button>

                      {theme === 'custom' && (
                        <div className="mt-2 pt-2 border-t border-border-primary px-3 pb-2">
                          <div className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-2">{t('accentColor')}</div>
                          <div className="flex flex-wrap gap-2">
                            {['#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444'].map((color) => (
                              <button
                                key={color}
                                onClick={() => setCustomAccent(color)}
                                className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${customAccent === color ? 'border-white' : 'border-transparent'}`}
                                style={{ backgroundColor: color }}
                              />
                            ))}
                            <input 
                              type="color" 
                              value={customAccent}
                              onChange={(e) => setCustomAccent(e.target.value)}
                              className="w-6 h-6 rounded-full overflow-hidden bg-transparent border-none cursor-pointer p-0"
                            />
                          </div>
                        </div>
                      )}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            <button 
              onClick={() => setShowHelpModal(true)}
              className="w-10 h-10 flex items-center justify-center bg-bg-primary/50 hover:bg-bg-primary border border-border-primary rounded-full transition-all text-text-secondary hover:text-text-primary"
              title={t('howToUse')}
            >
              <HelpCircle className="w-5 h-5" />
            </button>
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-white rounded-full transition-all text-sm font-semibold shadow-lg shadow-accent-primary/20"
            >
              <Upload className="w-4 h-4" />
              {t('upload')}
            </button>
            <input 
              type="file" 
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="video/*"
              className="hidden"
            />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Video Section */}
        <div className="lg:col-span-2 space-y-6">
          <div className="relative aspect-video bg-black rounded-2xl overflow-hidden border border-border-primary shadow-2xl group">
            {!videoSrc ? (
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer hover:bg-bg-primary/5 transition-colors"
              >
                <div className="w-16 h-16 bg-bg-primary/5 rounded-full flex items-center justify-center mb-4 border border-border-primary">
                  <Upload className="w-8 h-8 text-text-secondary/40" />
                </div>
                <p className="text-text-secondary font-medium">{t('dropVideo')}</p>
                {lastVideoName && (
                  <p className="text-accent-secondary/60 text-xs mt-2 bg-accent-primary/5 px-3 py-1 rounded-full border border-accent-primary/10">
                    {t('prevProcessing')} <span className="font-bold">{lastVideoName}</span>
                  </p>
                )}
                <p className="text-text-secondary/30 text-sm mt-2">{t('supports')}</p>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  src={videoSrc}
                  className="w-full h-full object-contain"
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onClick={togglePlay}
                />
                
                {/* Flash Effect */}
                <AnimatePresence>
                  {showFlash && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-white z-50 pointer-events-none"
                    />
                  )}
                </AnimatePresence>

                {/* Capture Indicator Overlay */}
                <AnimatePresence>
                  {showFlash && (
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                      className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none"
                    >
                      <div className="bg-accent-primary/90 backdrop-blur-md px-6 py-3 rounded-full flex items-center gap-3 shadow-2xl border border-white/20">
                        <Camera className="w-6 h-6 text-white" />
                        <span className="text-white font-bold uppercase tracking-widest text-sm">{t('captured')}</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                
                {/* Close Video Button */}
                <button 
                  onClick={() => {
                    setVideoSrc(null);
                    setIsPlaying(false);
                    setCurrentTime(0);
                  }}
                  className="absolute top-4 right-4 z-50 p-2 bg-black/40 hover:bg-black/60 backdrop-blur-md rounded-full text-white/60 hover:text-white transition-all border border-white/10 opacity-0 group-hover:opacity-100"
                  title={t('closeVideo')}
                >
                  <X className="w-5 h-5" />
                </button>

                {/* Custom Controls Overlay */}
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-6 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="flex flex-col gap-4">
                    {/* Progress Bar */}
                    <div 
                      ref={progressBarRef}
                      onClick={handleSeek}
                      className="relative h-1.5 bg-white/20 rounded-full overflow-hidden cursor-pointer"
                    >
                      <div 
                        className="absolute h-full bg-accent-primary" 
                        style={{ width: `${(currentTime / duration) * 100}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <button onClick={togglePlay} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                          {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
                        </button>
                        <span className="text-sm font-mono tabular-nums text-white/80">
                          {formatTime(currentTime)} / {formatTime(duration)}
                        </span>
                        
                        {/* Playback Speed Control */}
                        <div className="flex items-center gap-2 ml-2 bg-white/5 rounded-lg px-2 py-1 border border-white/10">
                          <span className="text-[10px] uppercase font-bold text-white/40">{t('speed')}</span>
                          <select 
                            value={playbackRate}
                            onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
                            className="bg-transparent text-xs font-bold text-white/80 outline-none cursor-pointer"
                          >
                            <option value="0.25" className="bg-bg-secondary">0.25x</option>
                            <option value="0.5" className="bg-bg-secondary">0.5x</option>
                            <option value="0.75" className="bg-bg-secondary">0.75x</option>
                            <option value="1" className="bg-bg-secondary">1x</option>
                            <option value="1.25" className="bg-bg-secondary">1.25x</option>
                            <option value="1.5" className="bg-bg-secondary">1.5x</option>
                            <option value="2" className="bg-bg-secondary">2x</option>
                            <option value="4" className="bg-bg-secondary">4x</option>
                          </select>
                        </div>
                      </div>

                      <button 
                        onClick={captureFrame}
                        className="flex items-center gap-2 px-6 py-2 bg-accent-primary hover:bg-accent-primary/90 text-white rounded-full font-semibold transition-all shadow-lg shadow-accent-primary/20 active:scale-95"
                      >
                        <Camera className="w-4 h-4" />
                        {t('captureBtn')}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Instructions */}
          <div className="bg-bg-secondary border border-border-primary rounded-2xl p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-text-secondary/40 mb-4">{t('howToUse')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-bg-primary/50 flex items-center justify-center shrink-0 border border-border-primary text-xs font-bold">1</div>
                <p className="text-sm text-text-secondary leading-relaxed">{t('step1')}</p>
              </div>
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-bg-primary/50 flex items-center justify-center shrink-0 border border-border-primary text-xs font-bold">2</div>
                <p className="text-sm text-text-secondary leading-relaxed">
                  {t('step2')} 
                  <span className="block mt-1 text-accent-secondary/80 italic">{t('seekTip')}</span>
                </p>
              </div>
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-bg-primary/50 flex items-center justify-center shrink-0 border border-border-primary text-xs font-bold">3</div>
                <p className="text-sm text-text-secondary leading-relaxed">{t('step3')}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Gallery Section */}
        <div className="flex flex-col h-[calc(100vh-10rem)]">
          <div className="flex flex-col gap-3 mb-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                {t('galleryTitle')}
                <span className="text-xs bg-bg-primary/50 px-2 py-0.5 rounded-full text-text-secondary">
                  {capturedFrames.length}
                </span>
              </h2>
              <div className="flex items-center gap-3">
                {capturedFrames.length > 0 && (
                  <>
                    <button 
                      onClick={downloadAllFrames}
                      disabled={isZipping}
                      className="text-xs text-accent-secondary hover:text-accent-primary transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isZipping ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Download className="w-3 h-3" />
                      )}
                      {isZipping ? t('zipping') : t('downloadAll')}
                    </button>
                    <button 
                      onClick={() => {
                        setCapturedFrames([]);
                        del('capturedFrames');
                      }}
                      disabled={isZipping}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                    >
                      {t('clearAll')}
                    </button>
                  </>
                )}
              </div>
            </div>
            
            {/* Sort Controls */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 p-1 bg-bg-primary/50 rounded-lg border border-border-primary">
                <button 
                  onClick={() => setSortBy('timeline')}
                  className={`text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 rounded-md transition-all ${sortBy === 'timeline' ? 'bg-accent-primary text-white shadow-lg shadow-accent-primary/20' : 'text-text-secondary/60 hover:text-text-primary'}`}
                >
                  {t('timeline')}
                </button>
                <button 
                  onClick={() => setSortBy('recent')}
                  className={`text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 rounded-md transition-all ${sortBy === 'recent' ? 'bg-accent-primary text-white shadow-lg shadow-accent-primary/20' : 'text-text-secondary/60 hover:text-text-primary'}`}
                >
                  {t('recent')}
                </button>
              </div>

              <button 
                onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                className="p-2 bg-bg-primary/50 hover:bg-bg-primary border border-border-primary rounded-lg transition-all text-text-secondary hover:text-text-primary"
                title={sortOrder === 'asc' ? t('sortAsc') : t('sortDesc')}
              >
                {sortOrder === 'asc' ? <ArrowUpAZ className="w-4 h-4" /> : <ArrowDownAZ className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div 
            ref={galleryRef}
            className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar"
          >
            <AnimatePresence initial={false}>
              {capturedFrames.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-text-secondary/20 border-2 border-dashed border-border-primary rounded-2xl p-8 text-center">
                  <Camera className="w-12 h-12 mb-4 opacity-20" />
                  <p className="text-sm">{t('noFrames')}</p>
                </div>
              ) : (
                [...capturedFrames]
                  .sort((a, b) => {
                    let comparison = 0;
                    if (sortBy === 'timeline') {
                      comparison = a.timestamp - b.timestamp;
                    } else {
                      comparison = a.captureOrder - b.captureOrder;
                    }
                    return sortOrder === 'asc' ? comparison : -comparison;
                  })
                  .map((frame) => (
                    <motion.div
                      key={frame.id}
                      id={`frame-${frame.id}`}
                      layout
                      initial={{ opacity: 0, y: 20, scale: 0.95 }}
                      animate={{ 
                        opacity: 1, 
                        y: 0, 
                        scale: 1,
                        borderColor: lastCapturedId === frame.id ? 'var(--accent-primary)' : 'var(--border-primary)',
                        boxShadow: lastCapturedId === frame.id ? '0 0 20px var(--accent-primary)' : 'none'
                      }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className={`group relative bg-bg-secondary border rounded-xl overflow-hidden transition-all duration-500 ${lastCapturedId === frame.id ? 'ring-2 ring-accent-primary/50' : 'border-border-primary'}`}
                    >
                      <img 
                        src={frame.dataUrl} 
                        alt={`Frame at ${frame.timestamp}`} 
                        className="w-full aspect-video object-cover"
                      />
                      <div className="absolute top-2 left-2 bg-accent-primary text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg">
                        F{frame.index.toString().padStart(3, '0')}
                      </div>
                      {lastCapturedId === frame.id && (
                        <div className="absolute top-2 right-2 bg-green-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter animate-pulse">
                          {t('new')}
                        </div>
                      )}
                      <div className="p-3 flex items-center justify-between bg-black/40 backdrop-blur-sm">
                      <span className="text-xs font-mono text-white/60">
                        {formatTime(frame.timestamp)}
                      </span>
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => setPreviewFrame(frame)}
                          className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-white/60 hover:text-white"
                          title={t('preview')}
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => downloadFrame(frame)}
                          className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-white/60 hover:text-white"
                          title={t('download')}
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => deleteFrame(frame.id)}
                          className="p-1.5 hover:bg-red-500/10 rounded-lg transition-colors text-white/60 hover:text-red-400"
                          title={t('delete')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Hidden Canvas for Processing */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Image Preview Modal */}
      <AnimatePresence>
        {previewFrame && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm"
            onClick={() => setPreviewFrame(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative max-w-5xl w-full bg-bg-secondary rounded-2xl overflow-hidden border border-border-primary shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="absolute top-4 right-4 z-10">
                <button 
                  onClick={() => setPreviewFrame(null)}
                  className="p-2 bg-black/50 hover:bg-black/80 rounded-full text-white transition-colors backdrop-blur-md"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <img 
                src={previewFrame.dataUrl} 
                alt="Preview" 
                className="w-full h-auto max-h-[80vh] object-contain"
              />
              
              <div className="p-6 flex items-center justify-between border-t border-border-primary">
                <div className="flex items-center gap-6">
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-text-secondary/40 uppercase tracking-wider">{t('index')}</span>
                    <span className="text-xl font-mono font-bold text-text-primary">F{previewFrame.index.toString().padStart(3, '0')}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-text-secondary/40 uppercase tracking-wider">{t('timestamp')}</span>
                    <span className="text-xl font-mono font-bold text-accent-secondary">{formatTime(previewFrame.timestamp)}</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => downloadFrame(previewFrame)}
                    className="flex items-center gap-2 px-6 py-3 bg-accent-primary hover:bg-accent-primary/90 text-white rounded-xl font-semibold transition-all shadow-lg shadow-accent-primary/20"
                  >
                    <Download className="w-5 h-5" />
                    {t('downloadImg')}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Download Confirmation Modal */}
      <AnimatePresence>
        {showDownloadConfirmModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-bg-secondary border border-border-primary rounded-3xl p-8 max-w-md w-full shadow-2xl"
            >
              <div className="w-16 h-16 bg-accent-primary/10 rounded-2xl flex items-center justify-center mb-6 border border-accent-primary/20">
                <Download className="w-8 h-8 text-accent-primary" />
              </div>
              <h3 className="text-2xl font-bold mb-2">{t('downloadConfirmTitle')}</h3>
              <p className="text-text-secondary mb-8 leading-relaxed">
                {t('downloadConfirmDesc', { count: capturedFrames.length })}
                <span className="block mt-2 text-red-400/80 text-sm italic">{t('downloadConfirmWarning')}</span>
              </p>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={handleDownloadAndContinue}
                  disabled={isZipping}
                  className="w-full py-4 bg-accent-primary hover:bg-accent-primary/90 text-white rounded-xl font-bold transition-all shadow-lg shadow-accent-primary/20 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isZipping ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                  {isZipping ? t('zipping') : t('downloadAndContinue')}
                </button>
                <button 
                  onClick={handleDiscardAndContinue}
                  className="w-full py-4 bg-bg-primary/50 hover:bg-bg-primary text-text-secondary hover:text-text-primary rounded-xl font-bold transition-all border border-border-primary"
                >
                  {t('discardAndContinue')}
                </button>
                <button 
                  onClick={() => {
                    setShowDownloadConfirmModal(false);
                    setPendingFile(null);
                  }}
                  className="w-full py-3 text-text-secondary/30 hover:text-text-secondary/50 text-sm font-medium transition-all"
                >
                  {t('cancel')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Resume Modal */}
      <AnimatePresence>
        {showResumeModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-bg-secondary border border-border-primary rounded-3xl p-8 max-w-md w-full shadow-2xl"
            >
              <div className="w-16 h-16 bg-accent-primary/10 rounded-2xl flex items-center justify-center mb-6 border border-accent-primary/20">
                <Video className="w-8 h-8 text-accent-primary" />
              </div>
              <h3 className="text-2xl font-bold mb-2">{t('resumeTitle')}</h3>
              <p className="text-text-secondary mb-8 leading-relaxed">
                {t('resumeDesc', { count: capturedFrames.length, name: pendingFile?.name || '' })}
              </p>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={() => pendingFile && processNewFile(pendingFile, true)}
                  className="w-full py-4 bg-accent-primary hover:bg-accent-primary/90 text-white rounded-xl font-bold transition-all shadow-lg shadow-accent-primary/20"
                >
                  {t('continueProcessing')}
                </button>
                <button 
                  onClick={() => pendingFile && processNewFile(pendingFile, false)}
                  className="w-full py-4 bg-bg-primary/50 hover:bg-bg-primary text-text-secondary hover:text-text-primary rounded-xl font-bold transition-all border border-border-primary"
                >
                  {t('startOver')}
                </button>
                <button 
                  onClick={() => {
                    setShowResumeModal(false);
                    setPendingFile(null);
                  }}
                  className="w-full py-3 text-text-secondary/30 hover:text-text-secondary/50 text-sm font-medium transition-all"
                >
                  {t('cancel')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Help Modal */}
      <AnimatePresence>
        {showHelpModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-bg-secondary border border-border-primary rounded-3xl p-8 max-w-2xl w-full shadow-2xl relative overflow-hidden"
            >
              <button 
                onClick={() => setShowHelpModal(false)}
                className="absolute top-6 right-6 p-2 hover:bg-bg-primary/5 rounded-full transition-colors text-text-secondary/40 hover:text-text-primary"
              >
                <X className="w-6 h-6" />
              </button>

              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 bg-accent-primary/10 rounded-xl flex items-center justify-center border border-accent-primary/20">
                  <HelpCircle className="w-6 h-6 text-accent-primary" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold">{t('helpTitle')}</h3>
                  <p className="text-text-secondary/40 text-sm">{t('helpSubtitle')}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="w-8 h-8 shrink-0 bg-bg-primary/5 rounded-lg flex items-center justify-center text-xs font-bold border border-border-primary">1</div>
                    <div>
                      <h4 className="font-semibold mb-1">{t('helpStep1Title')}</h4>
                      <p className="text-sm text-text-secondary/50">{t('helpStep1Desc')}</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-8 h-8 shrink-0 bg-bg-primary/5 rounded-lg flex items-center justify-center text-xs font-bold border border-border-primary">2</div>
                    <div>
                      <h4 className="font-semibold mb-1">{t('helpStep2Title')}</h4>
                      <p className="text-sm text-text-secondary/50">{t('helpStep2Desc')}</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-8 h-8 shrink-0 bg-bg-primary/5 rounded-lg flex items-center justify-center text-xs font-bold border border-border-primary">3</div>
                    <div>
                      <h4 className="font-semibold mb-1">{t('helpStep3Title')}</h4>
                      <p className="text-sm text-text-secondary/50">{t('helpStep3Desc')}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="w-8 h-8 shrink-0 bg-bg-primary/5 rounded-lg flex items-center justify-center text-xs font-bold border border-border-primary">4</div>
                    <div>
                      <h4 className="font-semibold mb-1">{t('helpStep4Title')}</h4>
                      <p className="text-sm text-text-secondary/50">{t('helpStep4Desc')}</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-8 h-8 shrink-0 bg-bg-primary/5 rounded-lg flex items-center justify-center text-xs font-bold border border-border-primary">5</div>
                    <div>
                      <h4 className="font-semibold mb-1">{t('helpStep5Title')}</h4>
                      <p className="text-sm text-text-secondary/50">{t('helpStep5Desc')}</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-8 h-8 shrink-0 bg-bg-primary/5 rounded-lg flex items-center justify-center text-xs font-bold border border-border-primary">6</div>
                    <div>
                      <h4 className="font-semibold mb-1">{t('helpStep6Title')}</h4>
                      <p className="text-sm text-text-secondary/50">{t('helpStep6Desc')}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-accent-primary/5 border border-accent-primary/10 rounded-2xl p-4 flex items-center gap-4">
                <div className="w-10 h-10 bg-accent-primary/20 rounded-full flex items-center justify-center">
                  <Camera className="w-5 h-5 text-accent-secondary" />
                </div>
                <p className="text-sm text-accent-secondary/70">
                  <span className="font-bold text-accent-secondary">{t('proTip')}</span> {t('proTipDesc')}
                </p>
              </div>

              <button 
                onClick={() => setShowHelpModal(false)}
                className="w-full mt-8 py-4 bg-bg-primary/50 hover:bg-bg-primary text-text-primary font-bold rounded-xl transition-all border border-border-primary"
              >
                {t('gotIt')}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: var(--border-primary);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: var(--text-secondary);
          opacity: 0.2;
        }
      `}</style>
    </div>
  );
}
