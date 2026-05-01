const CONFIG = {
  TIMEZONE: "America/Chicago",
  USERS_SHEET: "users",
  HEADERS: ["id", "user_id", "user_name", "date", "start_time", "end_time", "duration_minutes", "shift", "created_at"],
  USER_HEADERS: ["id", "name", "password", "is_admin", "is_active"]
};

// HELPER: Convert any time (HH:mm string or Date object) to minutes in the CONFIG timezone
function timeToMinutes(val) {
  if (!val) return 0;
  let timeStr = "";
  if (val instanceof Date) {
    timeStr = Utilities.formatDate(val, CONFIG.TIMEZONE, "HH:mm");
  } else {
    timeStr = val.toString().trim();
  }
  
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  
  let h = parseInt(match[1]);
  let m = parseInt(match[2]);
  
  if (timeStr.toLowerCase().includes('pm') && h < 12) h += 12;
  if (timeStr.toLowerCase().includes('am') && h === 12) h = 0;
  
  return h * 60 + m;
}

// HELPER: Get Current Date/Time in specific timezone strings
function getNow() {
  const now = new Date();
  return {
    date: Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyy-MM-dd"),
    time: Utilities.formatDate(now, CONFIG.TIMEZONE, "HH:mm"),
    totalMins: timeToMinutes(now)
  };
}

// HELPER: Get User Info by ID or Login by Name+Password
function getUserInfo(userId, loginParams) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const userSheet = ss.getSheetByName(CONFIG.USERS_SHEET);
    if (!userSheet) return null;
    const usersData = userSheet.getDataRange().getValues();
    
    for (let i = 1; i < usersData.length; i++) {
      const uId = usersData[i][0]?.toString().trim();
      const uName = usersData[i][1]?.toString().trim();
      const uPass = usersData[i][2]?.toString().trim();
      const uIsAdmin = usersData[i][3] ? usersData[i][3].toString().trim().toLowerCase() === 'true' : false;
      const uIsActive = usersData[i][4] === undefined || usersData[i][4] === "" || usersData[i][4].toString().trim().toLowerCase() === 'true';
      
      // Case 1: Login Check (Name + Password)
      if (loginParams && uName === loginParams.userName && uPass === loginParams.password) {
        return { userId: uId, userName: uName, isAdmin: uIsAdmin, isActive: uIsActive };
      }
      // Case 2: ID Check (for syncing)
      if (!loginParams && uId === userId?.toString().trim()) {
        return { userId: uId, userName: uName, isAdmin: uIsAdmin, isActive: uIsActive };
      }
    }
  } catch (e) { return null; }
  return null;
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action;
    var payload = data.payload;
    var result;
    if (action === 'getUser') result = getUser(payload.userId);
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({success: false, error: err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

function getShiftInfo(date) {
  const hour = parseInt(Utilities.formatDate(date, CONFIG.TIMEZONE, "HH"));
  return (hour < 12) ? "AM" : "PM";
}

function startSession(userId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const user = getUserInfo(userId);
    if (!user) throw new Error("User not found");
    
    const now = getNow();
    const monthKey = now.date.substring(0, 7);
    const sheet = getOrCreateMonthSheet(monthKey);
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (data[i][1].toString().trim() === userId.toString().trim()) {
        const rowDateStr = (data[i][3] instanceof Date) ? Utilities.formatDate(data[i][3], CONFIG.TIMEZONE, "yyyy-MM-dd") : data[i][3].toString();
        const rowEnd = data[i][5] ? data[i][5].toString().trim() : "";
        if (rowEnd === "") throw new Error("You already have an open session");
        if (rowDateStr === now.date) {
          const sMins = timeToMinutes(data[i][4]);
          const eMins = timeToMinutes(data[i][5]);
          if (now.totalMins >= sMins && now.totalMins < eMins) throw new Error("Overlap detected");
        }
      }
    }

    const shift = getShiftInfo(new Date());
    sheet.appendRow([Utilities.getUuid(), user.userId, user.userName, now.date, now.time, "", "", shift, new Date()]);
    return { success: true };
  } catch (e) { return { success: false, message: e.toString() }; }
  finally { lock.releaseLock(); }
}

function endSession(userId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const now = getNow();
    const monthKey = now.date.substring(0, 7);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(monthKey);
    if (!sheet) return { success: false, message: "Sheet not found" };
    
    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][1].toString().trim() === userId.toString().trim() && (!data[i][5] || data[i][5].toString().trim() === "")) {
        const startMins = timeToMinutes(data[i][4]);
        const durationMin = Math.max(1, now.totalMins - startMins);
        sheet.getRange(i + 1, 6).setValue(now.time);
        sheet.getRange(i + 1, 7).setValue(durationMin);
        return { success: true, duration: durationMin, endTime: now.time };
      }
    }
    return { success: false, message: "No open session found" };
  } catch (e) { return { success: false, message: e.toString() }; }
  finally { lock.releaseLock(); }
}

function doGet(e) {
  var action = e.parameter.action;
  var payload = JSON.parse(e.parameter.payload);
  var callback = e.parameter.callback;
  var result;
  try {
    if (action === 'getUser') result = getUser(payload.userId);
    else if (action === 'login') result = login(payload.userName, payload.password);
    else if (action === 'startSession') result = startSession(payload.userId);
    else if (action === 'endSession') result = endSession(payload.userId);
    else if (action === 'getUserReport') result = getUserReport(payload.userId, payload.monthKey);
    else if (action === 'getAdminReport') result = getAdminReport(payload.monthKey);
    else if (action === 'editEntry') result = editEntry(payload);
    else if (action === 'manualEntry') result = manualEntry(payload);
    else if (action === 'deleteEntry') result = deleteEntry(payload);
    else if (action === 'updateUser') result = updateUser(payload);
    else if (action === 'listAllUsers') result = listAllUsers(payload.adminId);
    else if (action === 'saveUser') result = saveUser(payload);
    else if (action === 'toggleUserStatus') result = toggleUserStatus(payload);

    return ContentService.createTextOutput(callback + "(" + JSON.stringify(result) + ")").setMimeType(ContentService.MimeType.JAVASCRIPT);
  } catch (err) {
    return ContentService.createTextOutput(callback + "(" + JSON.stringify({success: false, error: err.toString()}) + ")").setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
}

function login(userName, password) {
  const user = getUserInfo(null, { userName: userName?.trim(), password: password?.trim() });
  if (user) {
    if (!user.isActive) return { success: false, message: "Account is inactive" };
    const userDetails = getUser(user.userId);
    return { success: true, user: userDetails };
  }
  return { success: false, message: "Invalid Name or Password" };
}

function listAllUsers(adminId) {
  const admin = getUserInfo(adminId);
  if (!admin || !admin.isAdmin) return { success: false, message: "Unauthorized" };
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.USERS_SHEET);
  const data = sheet.getDataRange().getValues();
  const users = [];
  
  for (let i = 1; i < data.length; i++) {
    users.push({
      userId: data[i][0]?.toString(),
      userName: data[i][1]?.toString(),
      password: data[i][2]?.toString(),
      isAdmin: data[i][3]?.toString().toLowerCase() === 'true',
      isActive: data[i][4] === undefined || data[i][4] === "" || data[i][4].toString().toLowerCase() === 'true'
    });
  }
  return { success: true, users: users };
}

function saveUser(params) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const admin = getUserInfo(params.adminId);
    if (!admin || !admin.isAdmin) throw new Error("Unauthorized");

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.USERS_SHEET);
    const data = sheet.getDataRange().getValues();
    
    const targetUserId = params.userData.userId?.toString().trim();
    const newName = params.userData.userName?.trim();
    const newPass = params.userData.password?.trim();
    const newIsAdmin = params.userData.isAdmin;

    if (targetUserId) {
      // Edit existing
      let adminCount = 0;
      let targetRowIndex = -1;
      for (let i = 1; i < data.length; i++) {
        const uId = data[i][0].toString().trim();
        const uIsAdmin = data[i][3]?.toString().toLowerCase() === 'true';
        const uIsActive = data[i][4] === undefined || data[i][4] === "" || data[i][4].toString().toLowerCase() === 'true';
        
        if (uIsAdmin && uIsActive) adminCount++;
        if (uId === targetUserId) targetRowIndex = i + 1;
      }

      if (targetRowIndex === -1) throw new Error("User not found");

      // Safety: Cannot demote the last active admin
      const currentIsAdmin = data[targetRowIndex-1][3]?.toString().toLowerCase() === 'true';
      const currentIsActive = data[targetRowIndex-1][4] === undefined || data[targetRowIndex-1][4] === "" || data[targetRowIndex-1][4].toString().toLowerCase() === 'true';
      
      if (currentIsAdmin && currentIsActive && !newIsAdmin && adminCount <= 1) {
        throw new Error("Cannot demote the only active administrator");
      }

      sheet.getRange(targetRowIndex, 2, 1, 3).setValues([[newName, newPass, newIsAdmin]]);
      return { success: true };
    } else {
      // Add new
      const nextId = (data.length > 1) ? Math.max(...data.slice(1).map(r => parseInt(r[0]) || 0)) + 1 : 1;
      sheet.appendRow([nextId.toString(), newName, newPass, newIsAdmin, true]);
      return { success: true };
    }
  } catch (e) { return { success: false, message: e.toString() }; }
  finally { lock.releaseLock(); }
}

function toggleUserStatus(params) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const admin = getUserInfo(params.adminId);
    if (!admin || !admin.isAdmin) throw new Error("Unauthorized");

    if (params.targetUserId.toString() === params.adminId.toString()) throw new Error("Cannot deactivate yourself");

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.USERS_SHEET);
    const data = sheet.getDataRange().getValues();

    let adminCount = 0;
    let targetRowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      const uId = data[i][0].toString().trim();
      const uIsAdmin = data[i][3]?.toString().toLowerCase() === 'true';
      const uIsActive = data[i][4] === undefined || data[i][4] === "" || data[i][4].toString().toLowerCase() === 'true';
      
      if (uIsAdmin && uIsActive) adminCount++;
      if (uId === params.targetUserId.toString()) targetRowIndex = i + 1;
    }

    if (targetRowIndex === -1) throw new Error("User not found");

    const isTargetAdmin = data[targetRowIndex-1][3]?.toString().toLowerCase() === 'true';
    const currentStatus = data[targetRowIndex-1][4] === undefined || data[targetRowIndex-1][4] === "" || data[targetRowIndex-1][4].toString().toLowerCase() === 'true';

    // Safety: Cannot deactivate the last active admin
    if (currentStatus && isTargetAdmin && adminCount <= 1) {
      throw new Error("Cannot deactivate the only active administrator");
    }

    sheet.getRange(targetRowIndex, 5).setValue(!currentStatus);
    return { success: true, newStatus: !currentStatus };
  } catch (e) { return { success: false, message: e.toString() }; }
  finally { lock.releaseLock(); }
}

function updateUser(params) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.USERS_SHEET);
    const data = sheet.getDataRange().getValues();
    const oldId = params.oldId?.toString().trim();
    const newId = params.newId?.toString().trim();
    const newName = params.newName?.toString().trim();
    const newPass = params.newPassword?.toString().trim();

    // CRITICAL: Block any attempt to change user_id
    if (newId && newId !== oldId) {
      return { success: false, message: "Cannot change user ID" };
    }

    // Find the user by oldId and update only name and password
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString().trim() === oldId) {
        if (newName) sheet.getRange(i + 1, 2).setValue(newName);  // Column 2: user_name
        if (newPass) sheet.getRange(i + 1, 3).setValue(newPass);  // Column 3: user_password
        return { success: true };
      }
    }
    return { success: false, message: "User not found" };
  } catch (e) { return { success: false, message: e.toString() }; }
  finally { lock.releaseLock(); }
}

function parseDateSmart(val) {
  if (val instanceof Date) return val;
  if (!val) return null;
  const s = val.toString().trim();
  const match = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match) return new Date(match[1], match[2] - 1, match[3]);
  return new Date(s);
}

function getUser(userId) {
  if (!userId) return null;
  const info = getUserInfo(userId);
  if (!info) return null;
  
  // Lookup current userName and isAdmin from users sheet by userId
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName(CONFIG.USERS_SHEET);
  let currentUserName = info.userName;
  let isAdmin = info.isAdmin;
  if (userSheet) {
    const usersData = userSheet.getDataRange().getValues();
    for (let i = 1; i < usersData.length; i++) {
      const uId = usersData[i][0]?.toString().trim();
      if (uId === info.userId) {
        currentUserName = usersData[i][1]?.toString().trim();
        isAdmin = usersData[i][3] ? usersData[i][3].toString().trim().toLowerCase() === 'true' : false;
        break;
      }
    }
  }
  
  try {
    const user = { userId: info.userId, userName: currentUserName, isAdmin: isAdmin, activeStartTime: null, dailyTotal: 0 };
    const now = getNow();
    const monthSheet = ss.getSheetByName(now.date.substring(0, 7));
    if (monthSheet) {
      const data = monthSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][1].toString().trim() === info.userId) {
          const rowDateStr = (data[i][3] instanceof Date) ? Utilities.formatDate(data[i][3], CONFIG.TIMEZONE, "yyyy-MM-dd") : data[i][3].toString();
          if (rowDateStr === now.date) user.dailyTotal += (parseInt(data[i][6]) || 0);
          if (!data[i][5] || data[i][5].toString().trim() === "") {
            const d = parseDateSmart(data[i][8]);
            if (d) user.activeStartTime = d.getTime();
          }
        }
      }
    }
    return user;
  } catch (e) { return null; }
}

function getOrCreateMonthSheet(monthStr) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(monthStr);
  if (!sheet) {
    sheet = ss.insertSheet(monthStr);
    sheet.appendRow(CONFIG.HEADERS);
    sheet.getRange(1, 1, 1, CONFIG.HEADERS.length).setFontWeight("bold");
  }
  return sheet;
}

function getUserReport(userId, monthKey) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const user = getUserInfo(userId);
    
    // Lookup current userName from users sheet by userId
    let currentUserName = user?.userName || "";
    const userSheet = ss.getSheetByName(CONFIG.USERS_SHEET);
    if (userSheet) {
      const usersData = userSheet.getDataRange().getValues();
      for (let i = 1; i < usersData.length; i++) {
        const uId = usersData[i][0]?.toString().trim();
        if (uId === userId.toString().trim()) {
          currentUserName = usersData[i][1]?.toString().trim();
          break;
        }
      }
    }
    
    const sheet = ss.getSheetByName(monthKey);
    if (!sheet) return { entries: [], totalHours: "0.00", userName: currentUserName };
    
    const data = sheet.getDataRange().getValues();
    const entries = [];
    let totalMin = 0;
    const searchId = userId.toString().trim();
    for (let i = 1; i < data.length; i++) {
      if (data[i][1].toString().trim() === searchId) {
        const d = parseInt(data[i][6]) || 0;
        const dateStr = (data[i][3] instanceof Date) ? Utilities.formatDate(data[i][3], CONFIG.TIMEZONE, "yyyy-MM-dd") : data[i][3].toString();
        entries.push({ date: dateStr, start: data[i][4]?.toString() || "", end: data[i][5]?.toString() || "", duration: d, rowIndex: i + 1, monthKey: monthKey });
        totalMin += d;
      }
    }
    entries.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
    return { entries: entries, totalHours: (totalMin / 60).toFixed(2), userName: currentUserName };
  } catch (e) { return { entries: [], totalHours: "0.00", error: e.toString() }; }
}

function getAdminReport(monthKey) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const userSheet = ss.getSheetByName(CONFIG.USERS_SHEET);
    const monthSheet = ss.getSheetByName(monthKey);
    if (!userSheet) return { users: [], globalTotal: "0.00" };
    
    const usersData = userSheet.getDataRange().getValues();
    const reportData = monthSheet ? monthSheet.getDataRange().getValues() : [];
    const userStats = {};
    
    // Build user stats with current names from users sheet
    for (let i = 1; i < usersData.length; i++) {
      const uId = usersData[i][0]?.toString().trim();
      const currentName = usersData[i][1]?.toString().trim();
      if (uId) { userStats[uId] = { userId: uId, userName: currentName, totalMin: 0 }; }
    }
    
    let globalTotalMin = 0;
    for (let i = 1; i < reportData.length; i++) {
      const uId = reportData[i][1]?.toString().trim();
      const duration = parseInt(reportData[i][6]) || 0;
      if (userStats[uId]) { 
        userStats[uId].totalMin += duration; 
        globalTotalMin += duration; 
      }
    }
    
    const usersArray = Object.keys(userStats).map(uId => ({
      userId: uId, userName: userStats[uId].userName, totalHours: (userStats[uId].totalMin / 60).toFixed(2)
    })).sort((a, b) => parseFloat(b.totalHours) - parseFloat(a.totalHours));
    
    return { users: usersArray, globalTotal: (globalTotalMin / 60).toFixed(2) };
  } catch (e) { return { users: [], globalTotal: "0.00", error: e.toString() }; }
}

function manualEntry(params) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const user = getUserInfo(params.userId);
    if (!user) throw new Error("User not found");
    const now = getNow();
    const targetDateStr = params.date;
    const newStartMins = timeToMinutes(params.startTime);
    const newEndMins = timeToMinutes(params.endTime);

    if (targetDateStr > now.date) throw new Error("Cannot report future date");
    if (targetDateStr === now.date && newEndMins > now.totalMins) throw new Error("Cannot report future time");

    const sheet = getOrCreateMonthSheet(targetDateStr.substring(0, 7));
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][1].toString().trim() === params.userId.toString().trim()) {
        const rowDateStr = (data[i][3] instanceof Date) ? Utilities.formatDate(data[i][3], CONFIG.TIMEZONE, "yyyy-MM-dd") : data[i][3].toString();
        if (rowDateStr === targetDateStr) {
          const sMins = timeToMinutes(data[i][4]);
          let eMins = timeToMinutes(data[i][5]) || ((rowDateStr === now.date) ? now.totalMins : 1440);
          if (newStartMins < eMins && newEndMins > sMins) throw new Error("Overlap detected");
        }
      }
    }
    const duration = newEndMins - newStartMins;
    const shift = getShiftInfo(new Date(targetDateStr.replace(/-/g, '/') + " " + params.startTime));
    sheet.appendRow([Utilities.getUuid(), user.userId, user.userName, targetDateStr, params.startTime, params.endTime, duration, shift, new Date()]);
    return { success: true };
  } catch (e) { return { success: false, message: e.toString() }; }
  finally { lock.releaseLock(); }
}

function deleteEntry(data) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(data.monthKey);
    if (!sheet) return { success: false };
    sheet.deleteRow(parseInt(data.rowIndex));
    return { success: true };
  } catch (e) { return { success: false }; }
}

function editEntry(params) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const now = getNow();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(params.monthKey);
    if (!sheet) throw new Error("Sheet not found");
    const targetDateStr = params.date;
    const newStartMins = timeToMinutes(params.startTime);
    const newEndMins = timeToMinutes(params.endTime);

    if (targetDateStr > now.date) throw new Error("Cannot report future date");
    if (targetDateStr === now.date && newEndMins > now.totalMins) throw new Error("Cannot report future time");

    const allData = sheet.getDataRange().getValues();
    for (let i = 1; i < allData.length; i++) {
      if (i + 1 === parseInt(params.rowIndex)) continue;
      if (allData[i][1].toString().trim() === params.userId.toString().trim()) {
        const rowDateStr = (allData[i][3] instanceof Date) ? Utilities.formatDate(allData[i][3], CONFIG.TIMEZONE, "yyyy-MM-dd") : allData[i][3].toString();
        if (rowDateStr === targetDateStr) {
          const sMins = timeToMinutes(allData[i][4]);
          let eMins = timeToMinutes(allData[i][5]) || ((rowDateStr === now.date) ? now.totalMins : 1440);
          if (newStartMins < eMins && newEndMins > sMins) throw new Error("Overlap detected");
        }
      }
    }
    const duration = newEndMins - newStartMins;
    const shift = getShiftInfo(new Date(targetDateStr.replace(/-/g, '/') + " " + params.startTime));
    sheet.getRange(parseInt(params.rowIndex), 4, 1, 5).setValues([[targetDateStr, params.startTime, params.endTime, duration, shift]]);
    return { success: true };
  } catch (e) { return { success: false, message: e.toString() }; }
  finally { lock.releaseLock(); }
}
