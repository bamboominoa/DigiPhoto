/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  Image as ImageIcon, 
  CheckCircle2, 
  AlertCircle, 
  ChevronRight,
  ChevronLeft,
  Database,
  CloudUpload,
  X,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

// --- INSTRUCTIONS FOR USER (Google Apps Script) ---
/*
  1. Go to script.google.com
  2. Create a new project.
  3. Paste the following code:

  var TARGET_FOLDER_NAME = "digikiot_sanpham";

  function doGet(e) {
    try {
      var sheetId = e.parameter.sheetId;
      if (!sheetId) return createJsonResponse({ error: "Missing sheetId" });
      
      var pageSize = parseInt(e.parameter.pageSize || "24");
      var page = parseInt(e.parameter.page || "1");
      
      var ss = SpreadsheetApp.openById(sheetId);
      var sheet = ss.getSheets()[0];
      var lastRow = sheet.getLastRow();
      if (lastRow <= 1) return createJsonResponse({ data: [], total: 0 });
      
      var total = lastRow - 1;
      // Calculate range based on page (newest first)
      // Example: total 100, page 1, size 24 -> get rows 77-100
      var startRow = Math.max(2, lastRow - (page * pageSize) + 1);
      var endRow = lastRow - ((page - 1) * pageSize);
      
      if (startRow > lastRow || endRow < 2) return createJsonResponse({ data: [], total: total });
      
      var numRows = endRow - startRow + 1;
      var data = sheet.getRange(startRow, 1, numRows, 6).getValues();
      
      var result = [];
      for (var i = data.length - 1; i >= 0; i--) {
        var row = data[i];
        result.push({
          timestamp: Utilities.formatDate(new Date(row[0]), "GMT+7", "HH:mm dd/MM"),
          name: row[1],
          id: row[2],
          url: row[3],
          fileType: row[4],
          category: row[5] || "Chưa phân loại"
        });
      }
      return createJsonResponse({ data: result, total: total });
    } catch (err) {
      return createJsonResponse({ error: err.toString() });
    }
  }

  function doPost(e) {
    try {
      var data = JSON.parse(e.postData.contents);
      var fileName = data.fileName;
      var fileType = data.fileType;
      var base64Data = data.base64;
      var sheetId = data.sheetId;
      var category = data.category || "Chưa phân loại";
      
      var decodedData = Utilities.base64Decode(base64Data);
      var blob = Utilities.newBlob(decodedData, fileType, fileName);
      
      var parentFolder = getParentFolder(sheetId);
      var folderIterator = parentFolder.getFoldersByName(TARGET_FOLDER_NAME);
      var targetFolder = folderIterator.hasNext() ? folderIterator.next() : parentFolder.createFolder(TARGET_FOLDER_NAME);
      
      var file = targetFolder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      
      var fileId = file.getId();
      var directUrl = "https://lh3.googleusercontent.com/d/" + fileId;
      
      if (sheetId) {
        var ss = SpreadsheetApp.openById(sheetId);
        var sheet = ss.getSheets()[0];
        // Col: Date, Name, ID, URL, Type, Category
        sheet.appendRow([new Date(), fileName, fileId, directUrl, fileType, category]);
      }
      return createJsonResponse({ status: "success", fileId: fileId });
    } catch (err) {
      return createJsonResponse({ status: "error", message: err.toString() });
    }
  }

  function getParentFolder(sheetId) {
    if (sheetId && sheetId.trim() !== "") {
      try {
        var ssFile = DriveApp.getFileById(sheetId);
        var parents = ssFile.getParents();
        return parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
      } catch (e) { return DriveApp.getRootFolder(); }
    }
    return DriveApp.getRootFolder();
  }

  function createJsonResponse(data) {
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }

  4. Deploy as "Web App", Execute as "Me", Access "Anyone".
  5. IMPORTANT: Redeploy as NEW VERSION if you change code!
*/

interface UploadedFile {
  id: string;
  name: string;
  url: string;
  timestamp: string;
  category: string;
}

const CATEGORIES = ["Tất cả", "Camera", "Máy tính", "Phụ kiện", "Khác"];

export default function App() {
  const [gasUrl, setGasUrl] = useState<string>('https://script.google.com/macros/s/AKfycbxd7cJ1aMqNOkw0qwHT4pzVZQ59xilIa_IpR5gkvSTAnKOQVXpWNoiHtGA6NnplRgzdew/exec');
  const [folderId, setFolderId] = useState<string>(() => localStorage.getItem('folderId') || '');
  const [sheetId, setSheetId] = useState<string>('1BvCMwAq5zItV3fEqAy1saP7eTMQ66orrZ4CG6H_ecgM');
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ type: 'success' | 'error' | null, msg: string }>({ type: null, msg: '' });
  const [history, setHistory] = useState<UploadedFile[]>([]);
  const [totalItems, setTotalItems] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage, setItemsPerPage] = useState<number>(24);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [customFileName, setCustomFileName] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>(CATEGORIES[1]); // Default to "Camera"
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>(CATEGORIES[0]); // Default to "Tất cả"
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch remote files with pagination and caching
  const fetchRemoteFiles = async (page = currentPage, size = itemsPerPage) => {
    if (!gasUrl || !sheetId) return;
    setIsLoadingFiles(true);
    setUploadStatus({ type: null, msg: '' }); 
    
    try {
      // Session Cache for faster thumbnail/list loading
      const cacheKey = `files_${sheetId}_${page}_${size}`;
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed.data) {
            setHistory(parsed.data);
            setTotalItems(parsed.total || 0);
          }
        } catch (e) {
          console.warn("Lỗi đọc cache:", e);
        }
      }

      const response = await fetch(`${gasUrl}?sheetId=${sheetId}&page=${page}&pageSize=${size}`, {
        method: 'GET',
        redirect: 'follow',
      });
      
      if (response.ok) {
        const result = await response.json();
        if (result.data) {
          setHistory(result.data);
          setTotalItems(result.total);
          // Update cache
          sessionStorage.setItem(cacheKey, JSON.stringify(result));
        } else if (result.error) {
          setUploadStatus({ type: 'error', msg: 'Lỗi từ Google: ' + result.error });
        }
      } else {
        throw new Error("Mã phản hồi không hợp lệ");
      }
    } catch (error) {
      console.error("Lỗi đồng bộ danh sách:", error);
      setUploadStatus({ 
        type: 'error', 
        msg: '⚠️ Lỗi kết nối! Hãy chắc chắn bạn đã Deploy script ở bản NEW version.' 
      });
    } finally {
      setIsLoadingFiles(false);
    }
  };

  useEffect(() => {
    localStorage.setItem('folderId', folderId);
    
    if (gasUrl && sheetId) {
      fetchRemoteFiles(currentPage, itemsPerPage);
    }
  }, [folderId, currentPage, itemsPerPage]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    let file: File | null = null;
    if ('target' in event) {
      file = (event.target as HTMLInputElement).files?.[0] || null;
    } else if ('dataTransfer' in event) {
      event.preventDefault();
      file = event.dataTransfer.files?.[0] || null;
    }

    if (file) {
      setSelectedFile(file);
      const dotIndex = file.name.lastIndexOf('.');
      setCustomFileName(dotIndex > -1 ? file.name.substring(0, dotIndex) : file.name);
    }
  };

  const clearSelection = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedFile(null);
    setCustomFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const proceedWithUpload = async () => {
    if (!selectedFile || !gasUrl) return;

    setIsUploading(true);
    setUploadStatus({ type: null, msg: '' });

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = (e.target?.result as string).split(',')[1];
        
        const originalExt = selectedFile.name.substring(selectedFile.name.lastIndexOf('.'));
        const finalName = customFileName + (customFileName.toLowerCase().endsWith(originalExt.toLowerCase()) ? '' : originalExt);

        try {
          await fetch(gasUrl, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({
              fileName: finalName,
              fileType: selectedFile.type,
              base64: base64,
              folderId: folderId,
              sheetId: sheetId,
              category: selectedCategory
            }),
            headers: {
              'Content-Type': 'text/plain;charset=utf-8',
            }
          });

          setUploadStatus({ 
            type: 'success', 
            msg: 'Đã tải lên thành công!' 
          });
          
          setSelectedFile(null);
          setCustomFileName('');
          setTimeout(fetchRemoteFiles, 2000);
        } catch (error) {
          console.error(error);
          setUploadStatus({ type: 'error', msg: 'Lỗi tải lên. Kiểm tra lại URL.' });
        } finally {
          setIsUploading(false);
        }
      };
      reader.readAsDataURL(selectedFile);
    } catch (err) {
      setUploadStatus({ type: 'error', msg: 'Lỗi đọc tệp tin.' });
      setIsUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans selection:bg-blue-100 p-2 md:p-4 lg:p-6">
      {/* Header */}
      <header className="max-w-6xl mx-auto flex items-center justify-between mb-4 px-2">
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 p-1.5 rounded-lg text-white shadow-md">
            <CloudUpload size={18} />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight text-zinc-900">
              DigiKiot <span className="text-zinc-400 font-normal hidden sm:inline">| Photo</span>
            </h1>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={() => fetchRemoteFiles()}
            disabled={isLoadingFiles}
            className="p-1.5 rounded-lg bg-white border border-zinc-200 text-zinc-500 hover:bg-zinc-50 transition-colors shadow-sm"
          >
            <Loader2 size={16} className={cn(isLoadingFiles && "animate-spin")} />
          </button>
          
          <div className={cn(
            "hidden md:flex items-center px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest border shadow-sm transition-colors",
            gasUrl 
              ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
              : "bg-amber-50 text-amber-700 border-amber-200"
          )}>
            <div className={cn(
              "w-1.5 h-1.5 rounded-full mr-2",
              gasUrl ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-amber-500"
            )} />
            {gasUrl ? 'Online' : 'Offline'}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-3 auto-rows-min">
        {/* Upload Area */}
        <section className={cn(
          "bg-white border border-zinc-200 rounded-xl p-1.5 shadow-sm transition-all duration-500 relative overflow-hidden flex flex-col items-center justify-center md:col-span-12 lg:col-span-6",
          "border-dashed border-2 hover:border-blue-500 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:12px_12px]"
        )}>
          <div 
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileSelect}
            onClick={() => !isUploading && !selectedFile && fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-3 cursor-pointer group px-2"
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept="image/*"
              onChange={handleFileSelect} 
            />

            {!selectedFile ? (
              <>
                <div className={cn(
                  "w-10 h-10 flex-shrink-0 rounded-lg flex items-center justify-center transition-all duration-700",
                  isUploading ? "bg-blue-600 rotate-180" : "bg-zinc-900 group-hover:scale-105 shadow-md group-hover:bg-blue-600"
                )}>
                  {isUploading ? (
                    <Loader2 size={18} className="text-white animate-spin" />
                  ) : (
                    <Upload size={18} className="text-white" />
                  )}
                </div>

                <div className="text-left py-2">
                  <h3 className="text-xl font-bold tracking-tight text-zinc-900 leading-none">
                    Kéo thả ảnh lên đây
                  </h3>
                  <p className="text-zinc-500 text-xs font-medium mt-1">
                    Tự động lưu vào <strong>Drive & Sheet</strong>
                  </p>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col sm:flex-row items-center gap-3 py-2">
                <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600 flex-shrink-0">
                  <ImageIcon size={20} />
                </div>
                
                <div className="flex-1 flex flex-col min-w-0 w-full sm:w-auto">
                  <label className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Tên sản phẩm</label>
                  <input 
                    type="text"
                    value={customFileName}
                    onChange={(e) => setCustomFileName(e.target.value)}
                    autoFocus
                    className="bg-transparent border-b-2 border-blue-200 focus:border-blue-500 outline-none font-bold text-base py-0.5 text-zinc-900 w-full"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>

                <div className="flex flex-col w-full sm:w-32">
                  <label className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Loại</label>
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="bg-transparent border-b-2 border-blue-200 focus:border-blue-500 outline-none font-bold text-sm py-1 text-zinc-900 cursor-pointer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {CATEGORIES.slice(1).map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0 mt-2 sm:mt-0">
                   <button 
                    onClick={clearSelection}
                    className="p-2 text-zinc-400 hover:text-red-500 transition-colors"
                   >
                     <X size={18} />
                   </button>
                   <button 
                    disabled={isUploading}
                    onClick={(e) => { e.stopPropagation(); proceedWithUpload(); }}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-xs uppercase shadow-lg shadow-blue-200 active:scale-95 transition-transform"
                   >
                     {isUploading ? 'Đang gửi...' : 'Tải lên'}
                   </button>
                </div>
              </div>
            )}
            
            <AnimatePresence>
              {!selectedFile && uploadStatus.type && (
                <motion.div 
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={cn(
                    "ml-auto flex items-center gap-1 text-[10px] font-bold uppercase",
                    uploadStatus.type === 'success' ? "text-emerald-600" : "text-red-600"
                  )}
                >
                  {uploadStatus.type === 'success' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                  <span className="hidden sm:inline">{uploadStatus.msg}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>

        {/* Remote Stats - Compact */}
        <section className="md:col-span-6 lg:col-span-3 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl p-3 shadow-lg flex items-center justify-between overflow-hidden relative border-none">
            <div className="absolute -right-2 -bottom-2 opacity-15 text-white pointer-events-none">
              <ImageIcon size={60} />
            </div>
            <div className="z-10">
              <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-blue-100">Ảnh trong kho</label>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-white tracking-tighter">{history.length}</span>
                <span className="text-blue-200 font-bold text-[10px]">SẢN PHẨM</span>
              </div>
            </div>
          </section>

        {/* System Integrity - Compact */}
        <section className={cn(
          "rounded-xl p-3 shadow-md flex items-center justify-between transition-all overflow-hidden relative border-none",
          gasUrl 
            ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white" 
            : "bg-white border border-zinc-200 text-zinc-900",
          "md:col-span-6 lg:col-span-3"
        )}>
          {gasUrl && (
            <div className="absolute -right-2 -bottom-2 opacity-20 text-white pointer-events-none">
              <CheckCircle2 size={60} />
            </div>
          )}
          <div className="z-10">
            <label className={cn(
              "text-[10px] font-bold uppercase tracking-[0.1em]",
              gasUrl ? "text-emerald-100" : "text-zinc-400"
            )}>Hệ thống</label>
            <h3 className="text-sm font-bold mt-0.5 leading-none">
              {gasUrl ? 'Sẵn sàng' : 'Chưa kết nối'}
            </h3>
          </div>
          <div className={cn(
            "w-2 h-2 rounded-full z-10",
            gasUrl ? "bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)]" : "bg-amber-500"
          )} />
        </section>

        {/* Recent Activity */}
        <section id="image-list-top" className="md:col-span-12 bg-white border border-zinc-200 rounded-[32px] p-6 md:p-8 shadow-sm min-h-[400px]">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between mb-8 gap-4 px-2">
            <div>
              <h2 className="text-xl font-bold text-zinc-900 tracking-tight">Danh sách hình hiện có</h2>
              <p className="text-xs text-zinc-400 font-medium mt-1">Tổng cộng <strong>{totalItems}</strong> hình ảnh (Trang {currentPage}).</p>
            </div>
            
            <div className="flex flex-col sm:flex-row items-end sm:items-center gap-4 w-full lg:w-auto">
              {/* Search Bar */}
              <div className="relative w-full sm:w-64 flex-shrink-0">
                <input 
                  type="text"
                  placeholder="Tìm kiếm tên hình..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl py-2 pl-4 pr-10 text-sm outline-none focus:border-blue-500 transition-all font-medium"
                />
                <Database size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-300 pointer-events-none" />
              </div>

              {/* Category Filter - Wrapped */}
              <div className="flex flex-wrap items-center gap-2 justify-end">
                {CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setFilterCategory(cat)}
                    className={cn(
                      "px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all",
                      filterCategory === cat 
                        ? "bg-zinc-900 text-white shadow-md shadow-zinc-200" 
                        : "bg-zinc-50 text-zinc-400 hover:text-zinc-600 border border-zinc-100"
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {history.filter(item => {
              const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase());
              const matchesCategory = filterCategory === "Tất cả" || item.category === filterCategory;
              return matchesSearch && matchesCategory;
            }).length > 0 ? (
              history
                .filter(item => {
                  const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase());
                  const matchesCategory = filterCategory === "Tất cả" || item.category === filterCategory;
                  return matchesSearch && matchesCategory;
                })
                .map((item) => (
                  <div
                    key={item.id}
                    className="group relative h-44 bg-zinc-50 rounded-2xl border border-zinc-100 overflow-hidden shadow-sm hover:shadow-lg transition-shadow duration-300 cursor-pointer"
                    onClick={() => {
                      navigator.clipboard.writeText(item.url);
                      alert(`Đã copy link: ${item.name}`);
                    }}
                  >
                    {item.url ? (
                      <img 
                        src={item.url} 
                        alt={item.name} 
                        loading="lazy"
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-zinc-100 text-zinc-300">
                        <ImageIcon size={24} />
                      </div>
                    )}
                    
                    <div className="absolute top-2 left-2 z-10">
                      <span className="px-2 py-0.5 bg-black/40 backdrop-blur-md rounded-lg text-[7px] font-black uppercase text-white tracking-widest border border-white/10">
                        {item.category}
                      </span>
                    </div>

                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                      <p className="text-[10px] font-bold text-white truncate mb-1">
                        {item.name}
                      </p>
                      <div className="flex items-center justify-between text-[8px] text-zinc-300 font-bold uppercase tracking-widest">
                        <span>{item.timestamp}</span>
                        <div className="bg-white/20 px-2 py-0.5 rounded-full text-white backdrop-blur-sm">Copy Link</div>
                      </div>
                    </div>
                  </div>
                ))
            ) : (
              <div className="col-span-full py-16 flex flex-col items-center justify-center gap-4 bg-zinc-50/50 rounded-[32px] border border-dashed border-zinc-200">
                {isLoadingFiles ? (
                  <Loader2 size={32} className="animate-spin text-zinc-200" />
                ) : (
                  <>
                    <div className="w-16 h-16 rounded-[24px] border border-dashed border-zinc-200 flex items-center justify-center text-zinc-200">
                      <ImageIcon size={32} />
                    </div>
                    <div className="text-center">
                      <p className="text-zinc-400 font-bold text-xs uppercase tracking-widest">Thư mục trống hoặc lỗi kết nối</p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Pagination at Footer of Section */}
          <div className="mt-8 pt-8 border-t border-zinc-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-[10px] font-bold text-zinc-400 border border-zinc-100 px-3 py-1.5 rounded-lg bg-zinc-50 uppercase tracking-widest">
              Hiển thị: {history.length} / {totalItems} hình ảnh
            </div>

            <div className="flex items-center gap-4">
              {/* Items per page selection */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider">Số lượng:</span>
                <select 
                  value={itemsPerPage}
                  onChange={(e) => {
                    setItemsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="bg-zinc-50 border border-zinc-200 rounded-xl px-2 py-1.5 text-[10px] font-bold outline-none cursor-pointer hover:border-zinc-300 transition-colors"
                >
                  <option value={12}>12 ảnh</option>
                  <option value={24}>24 ảnh</option>
                  <option value={48}>48 ảnh</option>
                </select>
              </div>

              {/* Page navigation */}
              <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-xl px-2 py-1 flex-shrink-0">
                <button 
                  disabled={currentPage <= 1 || isLoadingFiles}
                  onClick={() => {
                    setCurrentPage(p => p - 1);
                    window.scrollTo({ top: document.getElementById('image-list-top')?.offsetTop || 0, behavior: 'smooth' });
                  }}
                  className="p-1.5 hover:bg-white rounded-lg transition-colors disabled:opacity-30"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-[10px] font-bold px-4 tabular-nums">Trang {currentPage}</span>
                <button 
                  disabled={currentPage * itemsPerPage >= totalItems || isLoadingFiles}
                  onClick={() => {
                    setCurrentPage(p => p + 1);
                    window.scrollTo({ top: document.getElementById('image-list-top')?.offsetTop || 0, behavior: 'smooth' });
                  }}
                  className="p-1.5 hover:bg-white rounded-lg transition-colors disabled:opacity-30"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="max-w-6xl mx-auto mt-16 pb-16 flex items-center justify-between px-6 border-t border-zinc-200 pt-8">
        <div className="flex items-center gap-6 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-300">
          <span className="text-zinc-500">&copy; 2024 DigiKiot Architecture</span>
          <span className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            Trạng thái hoạt động
          </span>
        </div>
      </footer>
    </div>
  );
}
