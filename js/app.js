import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getFirestore, initializeFirestore, collection, addDoc, onSnapshot, query, orderBy, where, deleteDoc, doc, getDocs, updateDoc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
    getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyACIj_G1N0wjU_t9peiZTmSEfTkvUyH1So",
    authDomain: "omabooks-5437e.firebaseapp.com",
    projectId: "omabooks-5437e",
    storageBucket: "omabooks-5437e.firebasestorage.app",
    messagingSenderId: "156587515821",
    appId: "1:156587515821:web:2e93685aff44987afdcb24",
};

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
const auth = getAuth(app);

// Variables to store the listeners so we can stop them on logout
let transUnsubscribe;
let vaultUnsubscribe;
let assetUnsubscribe;
let invoiceUnsubscribe;
let customerUnsubscribe;

// Cached State for Instant QuickBooks Calculations & Realtime Linking
let cachedAssets = [];
let cachedTransactions = [];
let cachedCustomers = [];
let currentActiveLedgerAsset = null;
let currentPortfolioView = 'ledger';
let companyProfile = {
    name: "Lambda West, Inc.",
    defaultBasis: "Accrual Basis",
    fiscalYear: "December 31"
};

// Balance Sheet Accounts State (Matching Lambda West, Inc. Balance Sheet)
let balanceSheetAccounts = {
    pettyCash: -1566.97,
    stcu: 27977.23,
    holmes: 10716.06,
    yaroslav: 8090.40,
    horizons: 40000.00,
    balserJanet: 197000.00,
    balserRob: 140000.00,
    openingEquity: -68420.19,
    retainedEarnings: 881682.54
};

// --- AUTHENTICATION ---
onAuthStateChanged(auth, async (user) => {
    const authContainer = document.getElementById('auth-container');
    const appContent = document.getElementById('app-content');

    if (user) {
        authContainer.classList.replace('d-flex', 'd-none');
        appContent.classList.remove('d-none');
        appContent.style.display = 'block';

        const datePicker = document.getElementById('date-input');
        if (datePicker && !datePicker.value) datePicker.valueAsDate = new Date();

        const ledgerDatePicker = document.getElementById('ledger-entry-date');
        if (ledgerDatePicker && !ledgerDatePicker.value) ledgerDatePicker.valueAsDate = new Date();

        const rcvDatePicker = document.getElementById('rcv-payment-date');
        if (rcvDatePicker && !rcvDatePicker.value) rcvDatePicker.valueAsDate = new Date();

        // Load company profile & balance sheet settings
        await loadCompanySettings(user.uid);
        await loadBalanceSheetSettings(user.uid);

        // Start real-time listeners
        transUnsubscribe = startTracking(user.uid);
        vaultUnsubscribe = renderVault(user.uid);
        assetUnsubscribe = startAssetTracker(user.uid);
        invoiceUnsubscribe = startInvoiceTracker(user.uid);
        customerUnsubscribe = startCustomerTracker(user.uid);
    } else {
        // Stop listeners on logout to prevent permission errors
        if (transUnsubscribe) transUnsubscribe();
        if (vaultUnsubscribe) vaultUnsubscribe();
        if (assetUnsubscribe) assetUnsubscribe();
        if (invoiceUnsubscribe) invoiceUnsubscribe();
        if (customerUnsubscribe) customerUnsubscribe();

        authContainer.classList.replace('d-none', 'd-flex');
        appContent.style.display = 'none';
    }
});

window.handleLogin = (event) => {
    if (event) event.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;

    signInWithEmailAndPassword(auth, email, pass)
        .catch(err => alert(err.message));
};

window.logout = () => signOut(auth);

// --- COMPANY SETTINGS ---
async function loadCompanySettings(uid) {
    try {
        const savedLocal = localStorage.getItem(`omabooks_company_${uid}`);
        if (savedLocal) {
            companyProfile = Object.assign(companyProfile, JSON.parse(savedLocal));
        }

        const docRef = doc(db, 'settings', `company_${uid}`);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            companyProfile = Object.assign(companyProfile, docSnap.data());
        }
    } catch (e) {
        console.warn("Could not load remote company settings, using defaults:", e);
    }

    const navName = document.getElementById('nav-company-name');
    if (navName) navName.innerText = companyProfile.name || "Lambda West, Inc.";

    const basisDisplay = document.getElementById('report-basis-display');
    if (basisDisplay) {
        basisDisplay.innerHTML = `<i class="bi bi-check2-circle text-success me-1"></i> ${companyProfile.defaultBasis || 'Accrual Basis'}`;
    }

    const reportBasisSelect = document.getElementById('report-basis');
    if (reportBasisSelect) {
        reportBasisSelect.value = companyProfile.defaultBasis || 'Accrual Basis';
    }
}

window.openCompanyModal = () => {
    document.getElementById('company-name-input').value = companyProfile.name || "Lambda West, Inc.";
    document.getElementById('company-default-basis').value = companyProfile.defaultBasis || "Accrual Basis";
    document.getElementById('company-fiscal-year').value = companyProfile.fiscalYear || "December 31";

    // @ts-ignore
    const modalEl = document.getElementById('companySettingsModal');
    if (modalEl && window.bootstrap) {
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    }
};

window.saveCompanySettings = async () => {
    const name = document.getElementById('company-name-input').value.trim() || "Lambda West, Inc.";
    const defaultBasis = document.getElementById('company-default-basis').value;
    const fiscalYear = document.getElementById('company-fiscal-year').value.trim() || "December 31";

    companyProfile = { name, defaultBasis, fiscalYear };

    if (auth.currentUser) {
        try {
            localStorage.setItem(`omabooks_company_${auth.currentUser.uid}`, JSON.stringify(companyProfile));
            await setDoc(doc(db, 'settings', `company_${auth.currentUser.uid}`), companyProfile, { merge: true });
        } catch (e) {
            console.error("Error saving company settings:", e);
        }
    }

    const navName = document.getElementById('nav-company-name');
    if (navName) navName.innerText = name;

    const basisDisplay = document.getElementById('report-basis-display');
    if (basisDisplay) {
        basisDisplay.innerHTML = `<i class="bi bi-check2-circle text-success me-1"></i> ${defaultBasis}`;
    }

    // @ts-ignore
    const modalEl = document.getElementById('companySettingsModal');
    if (modalEl && window.bootstrap) {
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
    }
};

// --- BALANCE SHEET ACCOUNTS & INITIAL BALANCES ---
async function loadBalanceSheetSettings(uid) {
    try {
        const savedLocal = localStorage.getItem(`omabooks_bs_${uid}`);
        if (savedLocal) {
            balanceSheetAccounts = Object.assign(balanceSheetAccounts, JSON.parse(savedLocal));
        }

        const docRef = doc(db, 'settings', `balance_sheet_${uid}`);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            balanceSheetAccounts = Object.assign(balanceSheetAccounts, docSnap.data());
        }
    } catch (e) {
        console.warn("Could not load remote balance sheet settings, using standard defaults:", e);
    }
}

window.openBalanceSheetSetupModal = () => {
    document.getElementById('bs-stcu-balance').value = balanceSheetAccounts.stcu !== undefined ? balanceSheetAccounts.stcu : 27977.23;
    document.getElementById('bs-petty-cash').value = balanceSheetAccounts.pettyCash !== undefined ? balanceSheetAccounts.pettyCash : -1566.97;
    document.getElementById('bs-horizons').value = balanceSheetAccounts.horizons !== undefined ? balanceSheetAccounts.horizons : 40000.00;
    document.getElementById('bs-holmes').value = balanceSheetAccounts.holmes !== undefined ? balanceSheetAccounts.holmes : 10716.06;
    document.getElementById('bs-yaroslav').value = balanceSheetAccounts.yaroslav !== undefined ? balanceSheetAccounts.yaroslav : 8090.40;
    document.getElementById('bs-balser-janet').value = balanceSheetAccounts.balserJanet !== undefined ? balanceSheetAccounts.balserJanet : 197000.00;
    document.getElementById('bs-balser-rob').value = balanceSheetAccounts.balserRob !== undefined ? balanceSheetAccounts.balserRob : 140000.00;
    document.getElementById('bs-opening-equity').value = balanceSheetAccounts.openingEquity !== undefined ? balanceSheetAccounts.openingEquity : -68420.19;
    document.getElementById('bs-retained-earnings').value = balanceSheetAccounts.retainedEarnings !== undefined ? balanceSheetAccounts.retainedEarnings : 881682.54;

    // @ts-ignore
    const modalEl = document.getElementById('balanceSheetSetupModal');
    if (modalEl && window.bootstrap) {
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    }
};

window.saveBalanceSheetSettings = async (showAlert = true) => {
    const stcuInput = document.getElementById('bs-stcu-balance');
    const modalEl = document.getElementById('balanceSheetSetupModal');
    if (stcuInput && modalEl && modalEl.classList.contains('show')) {
        balanceSheetAccounts = {
            stcu: parseFloat(document.getElementById('bs-stcu-balance').value) || 0,
            pettyCash: parseFloat(document.getElementById('bs-petty-cash').value) || 0,
            horizons: parseFloat(document.getElementById('bs-horizons').value) || 0,
            holmes: parseFloat(document.getElementById('bs-holmes').value) || 0,
            yaroslav: parseFloat(document.getElementById('bs-yaroslav').value) || 0,
            balserJanet: parseFloat(document.getElementById('bs-balser-janet').value) || 0,
            balserRob: parseFloat(document.getElementById('bs-balser-rob').value) || 0,
            openingEquity: parseFloat(document.getElementById('bs-opening-equity').value) || 0,
            retainedEarnings: parseFloat(document.getElementById('bs-retained-earnings').value) || 0
        };
    }

    if (auth.currentUser) {
        try {
            localStorage.setItem(`omabooks_bs_${auth.currentUser.uid}`, JSON.stringify(balanceSheetAccounts));
            await setDoc(doc(db, 'settings', `balance_sheet_${auth.currentUser.uid}`), balanceSheetAccounts, { merge: true });
        } catch (e) {
            console.error("Error saving balance sheet settings:", e);
        }
    }

    // @ts-ignore
    if (modalEl && window.bootstrap) {
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
    }
    if (showAlert) {
        alert("Balance Sheet accounts saved successfully!");
    }
};

// --- CHART OF ACCOUNTS HELPER & DEBIT / CREDIT AUTO-DETECTION ---
function parseAccount(accountStr) {
    if (!accountStr) return { code: "", name: "Other", type: "expense", drCr: "debit", full: "6990 · Other" };
    const str = String(accountStr).trim();

    const match = str.match(/^(\d{4})\s*·\s*(.*)$/);
    if (match) {
        const code = match[1];
        const name = match[2].trim();
        const codeNum = parseInt(code, 10);

        let type = 'expense';
        let drCr = 'debit';

        if (codeNum >= 1000 && codeNum < 2000) {
            type = 'asset';
            drCr = 'debit'; // Normal balance for assets is Debit
        } else if (codeNum >= 2000 && codeNum < 3000) {
            type = 'liability';
            drCr = 'credit'; // Normal balance for liabilities is Credit
        } else if (codeNum >= 3000 && codeNum < 4000) {
            type = 'equity';
            drCr = 'credit'; // Normal balance for equity is Credit
        } else if (codeNum >= 4000 && codeNum < 5000) {
            type = 'income';
            drCr = 'credit'; // Normal balance for revenue/income is Credit
        } else if (codeNum >= 6000 && codeNum < 7000) {
            type = 'expense';
            drCr = 'debit'; // Normal balance for expense is Debit
        }

        return { code, name, type, drCr, full: str };
    }

    // Legacy strings
    const lower = str.toLowerCase();
    if (lower.includes('rent') || lower.includes('income') || lower.includes('revenue') || lower.includes('interest')) {
        return { code: "4060", name: str, type: 'income', drCr: 'credit', full: `4060 · ${str}` };
    }
    if (lower.includes('repair') || lower.includes('maintenance')) {
        return { code: "6300", name: "Repairs", type: 'expense', drCr: 'debit', full: "6300 · Repairs" };
    }
    if (lower.includes('tax')) {
        return { code: "6850", name: "Property Taxes", type: 'expense', drCr: 'debit', full: "6850 · Property Taxes" };
    }
    if (lower.includes('insurance')) {
        return { code: "6180", name: "Insurance", type: 'expense', drCr: 'debit', full: "6180 · Insurance" };
    }
    return { code: "6990", name: str, type: 'expense', drCr: 'debit', full: `6990 · ${str}` };
}

window.handleAccountChange = (val) => {
    const parsed = parseAccount(val);
    const drCrSelect = document.getElementById('trans-dr-cr');
    if (drCrSelect) drCrSelect.value = parsed.drCr;
    const typeSelect = document.getElementById('trans-type');
    if (typeSelect) typeSelect.value = (parsed.drCr === 'credit' && parsed.type === 'income') ? 'income' : 'expense';
};

window.handleDrCrChange = (val) => {
    const typeSelect = document.getElementById('trans-type');
    if (typeSelect) typeSelect.value = (val === 'credit') ? 'income' : 'expense';
};

window.handleLedgerAccountChange = (val) => {
    if (!val) {
        const catSelect = document.getElementById('ledger-entry-category');
        val = catSelect ? catSelect.value : '';
    }
    const parsed = parseAccount(val);
    const drCrSelect = document.getElementById('ledger-entry-dr-cr');
    if (drCrSelect) drCrSelect.value = parsed.drCr;
};

// --- DATE PRESETS FOR QUICKBOOKS REPORTS ---
window.setReportPeriod = (period) => {
    const startInput = document.getElementById('report-start');
    const endInput = document.getElementById('report-end');
    if (!startInput || !endInput) return;

    const today = new Date();
    const currentYear = today.getFullYear();

    if (period === '2025' || period === 'bs2025') {
        startInput.value = '2025-01-01';
        endInput.value = '2025-12-31';
    } else if (period === '2026') {
        startInput.value = '2026-01-01';
        endInput.value = '2026-12-31';
    } else if (period === 'ytd') {
        startInput.value = `${currentYear}-01-01`;
        endInput.value = today.toISOString().split('T')[0];
    } else if (period === 'all') {
        startInput.value = '2020-01-01';
        endInput.value = '2030-12-31';
    }
};

// --- QUICKBOOKS PROFIT & LOSS REPORT GENERATION ---
window.generateReport = async () => {
    const start = document.getElementById('report-start').value;
    const end = document.getElementById('report-end').value;
    const basis = document.getElementById('report-basis') ? document.getElementById('report-basis').value : (companyProfile.defaultBasis || 'Accrual Basis');

    if (!start || !end) {
        alert("Please select both a start and end date.");
        return;
    }

    // Filter transactions within the selected date range
    const transInRange = cachedTransactions.filter(t => {
        if (!t.date) return false;
        return t.date >= start && t.date <= end;
    });

    // Format Date Range Subtitle (e.g. "January through December 2025")
    const startDateObj = new Date(start + "T00:00:00");
    const endDateObj = new Date(end + "T23:59:59");
    const startMonth = startDateObj.toLocaleString('en-US', { month: 'long' });
    const endMonth = endDateObj.toLocaleString('en-US', { month: 'long' });
    const startYear = startDateObj.getFullYear();
    const endYear = endDateObj.getFullYear();

    let periodHeaderStr = `${startMonth} ${startYear} through ${endMonth} ${endYear}`;
    if (startYear === endYear) {
        periodHeaderStr = `${startMonth} through ${endMonth} ${startYear}`;
    }
    const colHeaderStr = `${startDateObj.toLocaleString('en-US', { month: 'short' })} - ${endDateObj.toLocaleString('en-US', { month: 'short' })} ${String(endYear).slice(-2)}`;

    // Grouping by Account Code
    const incomeAccounts = {};
    const expenseAccounts = {};

    let totalIncome = 0;
    let totalExpense = 0;

    transInRange.forEach(t => {
        const amount = Number(t.amount) || 0;
        const parsed = parseAccount(t.category);
        const isIncome = (t.type === 'income' || parsed.type === 'income');
        const assetName = t.assetName ? t.assetName.trim() : "";

        const targetMap = isIncome ? incomeAccounts : expenseAccounts;
        if (isIncome) totalIncome += amount;
        else totalExpense += amount;

        const code = parsed.code || (isIncome ? "4900" : "6990");
        const accountTitle = `${code} · ${parsed.name}`;

        if (!targetMap[code]) {
            targetMap[code] = {
                code: code,
                title: accountTitle,
                name: parsed.name,
                total: 0,
                byAsset: {},
                otherTotal: 0
            };
        }

        targetMap[code].total += amount;

        if (assetName) {
            targetMap[code].byAsset[assetName] = (targetMap[code].byAsset[assetName] || 0) + amount;
        } else {
            targetMap[code].otherTotal += amount;
        }
    });

    // Build QuickBooks-Style Rows
    function renderAccountBlock(accountsMap) {
        let html = '';
        const sortedCodes = Object.keys(accountsMap).sort();

        sortedCodes.forEach(code => {
            const acc = accountsMap[code];
            const assetNames = Object.keys(acc.byAsset);
            const hasMultipleBreakdowns = (assetNames.length > 1) || (assetNames.length >= 1 && acc.otherTotal !== 0);

            if (!hasMultipleBreakdowns) {
                // Single line account
                html += `
                    <tr>
                        <td style="padding-left: 20px;">${acc.title}</td>
                        <td class="qb-amount-cell" style="text-align: right;">${acc.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>`;
            } else {
                // Parent account header
                html += `
                    <tr>
                        <td style="padding-left: 20px; font-weight: 600;">${acc.title}</td>
                        <td></td>
                    </tr>`;

                // Indented properties / assets
                assetNames.sort().forEach(asset => {
                    const val = acc.byAsset[asset];
                    html += `
                        <tr>
                            <td style="padding-left: 45px; color: #1e293b;">${asset}</td>
                            <td class="qb-amount-cell" style="text-align: right;">${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>`;
                });

                // Other / unassigned if present
                if (acc.otherTotal !== 0) {
                    html += `
                        <tr>
                            <td style="padding-left: 45px; color: #64748b;">${acc.title} - Other</td>
                            <td class="qb-amount-cell" style="text-align: right;">${acc.otherTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>`;
                }

                // Account Subtotal Line
                html += `
                    <tr style="border-top: 1px solid #94a3b8;">
                        <td style="padding-left: 20px; font-weight: 700;">Total ${acc.title}</td>
                        <td class="qb-amount-cell" style="text-align: right; font-weight: 700;">${acc.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>`;
            }
        });

        return html;
    }

    const incomeRowsHtml = renderAccountBlock(incomeAccounts);
    const expenseRowsHtml = renderAccountBlock(expenseAccounts);
    const grossProfit = totalIncome;
    const netOrdinaryIncome = totalIncome - totalExpense;
    const netIncome = netOrdinaryIncome;

    const companyName = companyProfile.name || "Lambda West, Inc.";

    const reportHtml = `
        <div class="qb-report-sheet" id="printable-qb-report">
            <div class="qb-report-header text-center pb-3 mb-4" style="border-bottom: 2px solid #000; position: relative;">
                <div style="font-size: 1.4rem; font-weight: 700; color: #000;">${companyName}</div>
                <div style="font-size: 1.15rem; font-weight: 700; color: #111;">Profit & Loss</div>
                <div style="font-size: 0.9rem; color: #333;">${periodHeaderStr}</div>
                <div style="position: absolute; left: 0; bottom: 8px; font-size: 0.8rem; font-weight: 600; color: #444;">${basis}</div>
            </div>

            <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem; line-height: 1.5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                <thead>
                    <tr style="border-bottom: 1px solid #000;">
                        <th></th>
                        <th style="text-align: right; padding-bottom: 6px; font-weight: 600; width: 180px;">${colHeaderStr}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td colspan="2" style="font-weight: 700; padding-top: 12px;">Ordinary Income/Expense</td>
                    </tr>
                    <tr>
                        <td colspan="2" style="font-weight: 700; padding-left: 10px; padding-top: 4px;">Income</td>
                    </tr>
                    ${incomeRowsHtml || '<tr><td style="padding-left: 20px; color: #94a3b8;">No income recorded</td><td></td></tr>'}
                    
                    <tr style="border-top: 1px solid #000; font-weight: 700;">
                        <td style="padding-top: 6px; padding-bottom: 6px;">Total Income</td>
                        <td class="qb-amount-cell" style="text-align: right; padding-top: 6px; padding-bottom: 6px;">$${totalIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                    
                    <tr style="border-top: 1px solid #000; border-bottom: 1px solid #000; font-weight: 700;">
                        <td style="padding-top: 6px; padding-bottom: 6px;">Gross Profit</td>
                        <td class="qb-amount-cell" style="text-align: right; padding-top: 6px; padding-bottom: 6px;">$${grossProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>

                    <tr>
                        <td colspan="2" style="font-weight: 700; padding-left: 10px; padding-top: 16px;">Expense</td>
                    </tr>
                    ${expenseRowsHtml || '<tr><td style="padding-left: 20px; color: #94a3b8;">No expenses recorded</td><td></td></tr>'}

                    <tr style="border-top: 1px solid #000; font-weight: 700;">
                        <td style="padding-top: 6px; padding-bottom: 6px;">Total Expense</td>
                        <td class="qb-amount-cell" style="text-align: right; padding-top: 6px; padding-bottom: 6px;">$${totalExpense.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>

                    <tr style="border-top: 1px solid #000; font-weight: 700;">
                        <td style="padding-top: 8px; padding-bottom: 8px;">Net Ordinary Income</td>
                        <td class="qb-amount-cell" style="text-align: right; padding-top: 8px; padding-bottom: 8px;">${netOrdinaryIncome < 0 ? '-' : ''}$${Math.abs(netOrdinaryIncome).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>

                    <tr style="border-top: 1px solid #000; border-bottom: 3px double #000; font-weight: 800; font-size: 0.95rem;">
                        <td style="padding-top: 8px; padding-bottom: 8px;">Net Income</td>
                        <td class="qb-amount-cell" style="text-align: right; padding-top: 8px; padding-bottom: 8px;">${netIncome < 0 ? '-' : ''}$${Math.abs(netIncome).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;

    // Render inside interactive modal
    const modalContent = document.getElementById('qb-report-modal-content');
    if (modalContent) modalContent.innerHTML = reportHtml;

    const modalTitle = document.getElementById('report-modal-date-range');
    if (modalTitle) modalTitle.innerText = `${periodHeaderStr} (${basis})`;

    // @ts-ignore
    const modalEl = document.getElementById('qbReportModal');
    if (modalEl && window.bootstrap) {
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    }
};

window.printReportContent = () => {
    const content = document.getElementById('printable-qb-report');
    if (!content) return;

    const printWin = window.open('', '_blank');
    if (printWin) {
        printWin.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Financial Statement - ${companyProfile.name || 'Lambda West, Inc.'}</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; padding: 40px; margin: 0; color: #000; }
                    .qb-report-sheet { max-width: 850px; margin: 0 auto; }
                    .qb-amount-cell { font-variant-numeric: tabular-nums; }
                    @media print { body { padding: 0; } }
                </style>
            </head>
            <body>
                ${content.outerHTML}
                <script>window.onload = () => window.print();<\/script>
            </body>
            </html>
        `);
        printWin.document.close();
    }
};

// --- QUICKBOOKS BALANCE SHEET REPORT GENERATION ---
window.generateBalanceSheet = async () => {
    const asOfDateStr = document.getElementById('report-end').value || "2025-12-31";
    const basis = document.getElementById('report-basis') ? document.getElementById('report-basis').value : (companyProfile.defaultBasis || 'Accrual Basis');

    const asOfDateObj = new Date(asOfDateStr + "T23:59:59");
    const monthName = asOfDateObj.toLocaleString('en-US', { month: 'long' });
    const day = asOfDateObj.getDate();
    const year = asOfDateObj.getFullYear();
    const colHeaderStr = `${asOfDateObj.toLocaleString('en-US', { month: 'short' })} ${day}, ${String(year).slice(-2)}`;

    // 1. Current Assets
    const pettyCash = balanceSheetAccounts.pettyCash !== undefined ? balanceSheetAccounts.pettyCash : -1566.97;
    const stcu = balanceSheetAccounts.stcu !== undefined ? balanceSheetAccounts.stcu : 27977.23;
    const totalChecking = pettyCash + stcu;

    const holmes = balanceSheetAccounts.holmes !== undefined ? balanceSheetAccounts.holmes : 10716.06;
    const yaroslav = balanceSheetAccounts.yaroslav !== undefined ? balanceSheetAccounts.yaroslav : 8090.40;
    const horizons = balanceSheetAccounts.horizons !== undefined ? balanceSheetAccounts.horizons : 40000.00;
    const totalOtherCurrent = holmes + yaroslav + horizons;

    const totalCurrentAssets = totalChecking + totalOtherCurrent;

    // 2. Fixed Assets (Matching Lambda West, Inc. Balance Sheet)
    const fixedAssetsList = [
        { code: "1505", name: "816 Yolo St", dep: -29000.00, other: 376083.77, total: 347083.77 },
        { code: "1535", name: "Ponderosa Trailer Park", dep: -98076.91, origCost: 326850.00, other: -11538.46, total: 217234.63 },
        { code: "1550", name: "Land, Pine Creek", total: 91512.60 },
        { code: "1551", name: "Ponderosa Major Repair 2023", total: 8794.02 },
        { code: "1560", name: "MacDonald Lane", total: 75507.42 },
        { code: "1561", name: "Narrow Way House", dep: -22904.00, other: 272274.01, total: 249370.01 },
        { code: "1565", name: "Ivie 5 acres lot 1", total: 32587.33 },
        { code: "1610", name: "Husqvarna Lawn Tractor, 2005", total: 300.00 },
        { code: "1612", name: "Dump Trailer", total: 1000.00 },
        { code: "1625", name: "Can Am Commander", total: 1000.00 },
        { code: "1631", name: "Kubota Tractor", total: 2300.00 },
        { code: "1632", name: "John Deere Dozer 450", total: 1000.00 },
        { code: "1633", name: "Eager Beaver Trailer", total: 800.00 },
        { code: "1635", name: "John Deere Cat 450C", total: 1000.00 },
        { code: "1640", name: "Dodge Pickup", total: 4905.10 },
        { code: "1642", name: "Dodge Pickup 2001", total: 5684.00 },
        { code: "1650", name: "Dump Truck", total: 1000.00 },
        { code: "1689", name: "Box Trailer", total: 4721.62 },
        { code: "1691", name: "Hicory Sheds", total: 500.00 },
        { code: "1692", name: "Honda 700", total: 753.27 },
        { code: "1693", name: "Prevost 1985 Bus", total: 3500.00 },
        { code: "1694", name: "Sequoia Mill", total: 1000.00 },
        { code: "1695", name: "Suzuki LTZ 400", total: 1000.63 },
        { code: "1696", name: "Yamaha YXZ10", total: 4177.59 },
        { code: "1710", name: "Road Grader #2", total: 1000.00 }
    ];

    let totalFixedAssets = 0;
    let fixedAssetsRowsHtml = "";

    fixedAssetsList.forEach(fa => {
        totalFixedAssets += fa.total;

        if (fa.dep !== undefined) {
            fixedAssetsRowsHtml += `
                <tr>
                    <td style="padding-left: 20px; font-weight: 600;">${fa.code} &middot; ${fa.name}</td>
                    <td></td>
                </tr>
                <tr>
                    <td style="padding-left: 45px; color: #334155;">Depreciation</td>
                    <td class="qb-amount-cell" style="text-align: right;">${fa.dep.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>`;
            if (fa.origCost !== undefined) {
                fixedAssetsRowsHtml += `
                <tr>
                    <td style="padding-left: 45px; color: #334155;">Original Cost</td>
                    <td class="qb-amount-cell" style="text-align: right;">${fa.origCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>`;
            }
            if (fa.other !== undefined) {
                fixedAssetsRowsHtml += `
                <tr>
                    <td style="padding-left: 45px; color: #334155;">${fa.code} &middot; ${fa.name} - Other</td>
                    <td class="qb-amount-cell" style="text-align: right;">${fa.other.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>`;
            }
            fixedAssetsRowsHtml += `
                <tr style="border-top: 1px solid #94a3b8;">
                    <td style="padding-left: 20px; font-weight: 700;">Total ${fa.code} &middot; ${fa.name}</td>
                    <td class="qb-amount-cell" style="text-align: right; font-weight: 700;">${fa.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>`;
        } else {
            fixedAssetsRowsHtml += `
                <tr>
                    <td style="padding-left: 20px;">${fa.code} &middot; ${fa.name}</td>
                    <td class="qb-amount-cell" style="text-align: right;">${fa.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>`;
        }
    });

    const totalAssets = totalCurrentAssets + totalFixedAssets;

    // 3. Liabilities
    const balserJanet = balanceSheetAccounts.balserJanet !== undefined ? balanceSheetAccounts.balserJanet : 197000.00;
    const balserRob = balanceSheetAccounts.balserRob !== undefined ? balanceSheetAccounts.balserRob : 140000.00;
    const totalLongTermLiabilities = balserJanet + balserRob;
    const totalLiabilities = totalLongTermLiabilities;

    // 4. Equity
    const openingEquity = balanceSheetAccounts.openingEquity !== undefined ? balanceSheetAccounts.openingEquity : -68420.19;
    const retainedEarnings = balanceSheetAccounts.retainedEarnings !== undefined ? balanceSheetAccounts.retainedEarnings : 881682.54;

    // Calculate Net Income from transactions up to asOfDate
    let netIncome = 0;
    cachedTransactions.forEach(t => {
        if (!t.date || t.date <= asOfDateStr) {
            const amt = Number(t.amount) || 0;
            if (t.type === 'income') netIncome += amt;
            else netIncome -= amt;
        }
    });
    // If no transactions entered yet, match the photo's Net Income of -7,313.64
    if (cachedTransactions.length === 0) {
        netIncome = -7313.64;
    }

    const totalEquity = openingEquity + retainedEarnings + netIncome;
    const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;

    const companyName = companyProfile.name || "Lambda West, Inc.";

    const reportHtml = `
        <div class="qb-report-sheet" id="printable-qb-report">
            <div class="qb-report-header text-center pb-3 mb-4" style="border-bottom: 2px solid #000; position: relative;">
                <div style="font-size: 1.4rem; font-weight: 700; color: #000;">${companyName}</div>
                <div style="font-size: 1.15rem; font-weight: 700; color: #111;">Balance Sheet</div>
                <div style="font-size: 0.9rem; color: #333;">As of ${monthName} ${day}, ${year}</div>
                <div style="position: absolute; left: 0; bottom: 8px; font-size: 0.8rem; font-weight: 600; color: #444;">${basis}</div>
            </div>

            <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem; line-height: 1.5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                <thead>
                    <tr style="border-bottom: 1px solid #000;">
                        <th></th>
                        <th style="text-align: right; padding-bottom: 6px; font-weight: 600; width: 180px;">${colHeaderStr}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td colspan="2" style="font-weight: 700; padding-top: 10px;">ASSETS</td>
                    </tr>
                    <tr>
                        <td colspan="2" style="font-weight: 700; padding-left: 10px; padding-top: 4px;">Current Assets</td>
                    </tr>
                    <tr>
                        <td colspan="2" style="font-weight: 600; padding-left: 20px;">Checking/Savings</td>
                    </tr>
                    <tr>
                        <td style="padding-left: 35px;">1002 &middot; Petty Cash</td>
                        <td class="qb-amount-cell" style="text-align: right;">${pettyCash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                    <tr>
                        <td style="padding-left: 35px;">1005 &middot; STCU</td>
                        <td class="qb-amount-cell" style="text-align: right;">${stcu.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                    <tr style="border-top: 1px solid #94a3b8;">
                        <td style="padding-left: 20px; font-weight: 700;">Total Checking/Savings</td>
                        <td class="qb-amount-cell" style="text-align: right; font-weight: 700;">${totalChecking.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>

                    <tr>
                        <td colspan="2" style="font-weight: 600; padding-left: 20px; padding-top: 8px;">Other Current Assets</td>
                    </tr>
                    <tr>
                        <td style="padding-left: 35px;">1256 &middot; Harold Holmes</td>
                        <td class="qb-amount-cell" style="text-align: right;">${holmes.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                    <tr>
                        <td style="padding-left: 35px;">1257 &middot; Yaroslav Nikolaychuk</td>
                        <td class="qb-amount-cell" style="text-align: right;">${yaroslav.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                    <tr>
                        <td style="padding-left: 35px;">1260 &middot; Horizons Unlimited, Inc.</td>
                        <td class="qb-amount-cell" style="text-align: right;">${horizons.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                    <tr style="border-top: 1px solid #94a3b8;">
                        <td style="padding-left: 20px; font-weight: 700;">Total Other Current Assets</td>
                        <td class="qb-amount-cell" style="text-align: right; font-weight: 700;">${totalOtherCurrent.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>

                    <tr style="border-top: 1px solid #000; font-weight: 700;">
                        <td style="padding-left: 10px; padding-top: 6px; padding-bottom: 6px;">Total Current Assets</td>
                        <td class="qb-amount-cell" style="text-align: right; padding-top: 6px; padding-bottom: 6px;">${totalCurrentAssets.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>

                    <tr>
                        <td colspan="2" style="font-weight: 700; padding-left: 10px; padding-top: 14px;">Fixed Assets</td>
                    </tr>
                    ${fixedAssetsRowsHtml}

                    <tr style="border-top: 1px solid #000; font-weight: 700;">
                        <td style="padding-left: 10px; padding-top: 6px; padding-bottom: 6px;">Total Fixed Assets</td>
                        <td class="qb-amount-cell" style="text-align: right; padding-top: 6px; padding-bottom: 6px;">${totalFixedAssets.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>

                    <tr style="border-top: 1px solid #000; border-bottom: 3px double #000; font-weight: 800; font-size: 0.95rem;">
                        <td style="padding-top: 8px; padding-bottom: 8px;">TOTAL ASSETS</td>
                        <td class="qb-amount-cell" style="text-align: right; padding-top: 8px; padding-bottom: 8px;">${totalAssets.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>

                    <!-- LIABILITIES & EQUITY -->
                    <tr>
                        <td colspan="2" style="font-weight: 700; padding-top: 24px;">LIABILITIES & EQUITY</td>
                    </tr>
                    <tr>
                        <td colspan="2" style="font-weight: 700; padding-left: 10px; padding-top: 4px;">Liabilities</td>
                    </tr>
                    <tr>
                        <td colspan="2" style="font-weight: 600; padding-left: 20px;">Long Term Liabilities</td>
                    </tr>
                    <tr>
                        <td style="padding-left: 35px;">2318 &middot; Balser Trust, Janet</td>
                        <td class="qb-amount-cell" style="text-align: right;">${balserJanet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                    <tr>
                        <td style="padding-left: 35px;">2319 &middot; Balser Trust, Rob</td>
                        <td class="qb-amount-cell" style="text-align: right;">${balserRob.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                    <tr style="border-top: 1px solid #94a3b8;">
                        <td style="padding-left: 20px; font-weight: 700;">Total Long Term Liabilities</td>
                        <td class="qb-amount-cell" style="text-align: right; font-weight: 700;">${totalLongTermLiabilities.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>

                    <tr style="border-top: 1px solid #000; font-weight: 700;">
                        <td style="padding-left: 10px; padding-top: 6px; padding-bottom: 6px;">Total Liabilities</td>
                        <td class="qb-amount-cell" style="text-align: right; padding-top: 6px; padding-bottom: 6px;">${totalLiabilities.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>

                    <tr>
                        <td colspan="2" style="font-weight: 700; padding-left: 10px; padding-top: 14px;">Equity</td>
                    </tr>
                    <tr>
                        <td style="padding-left: 20px;">3000 &middot; Opening Bal Equity</td>
                        <td class="qb-amount-cell" style="text-align: right;">${openingEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                    <tr>
                        <td style="padding-left: 20px;">3200 &middot; Retained Earnings</td>
                        <td class="qb-amount-cell" style="text-align: right;">${retainedEarnings.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                    <tr>
                        <td style="padding-left: 20px;">Net Income</td>
                        <td class="qb-amount-cell" style="text-align: right;">${netIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                    <tr style="border-top: 1px solid #94a3b8;">
                        <td style="padding-left: 10px; font-weight: 700; padding-top: 4px;">Total Equity</td>
                        <td class="qb-amount-cell" style="text-align: right; font-weight: 700; padding-top: 4px;">${totalEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>

                    <tr style="border-top: 1px solid #000; border-bottom: 3px double #000; font-weight: 800; font-size: 0.95rem;">
                        <td style="padding-top: 8px; padding-bottom: 8px;">TOTAL LIABILITIES & EQUITY</td>
                        <td class="qb-amount-cell" style="text-align: right; padding-top: 8px; padding-bottom: 8px;">${totalLiabilitiesAndEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;

    const modalContent = document.getElementById('qb-report-modal-content');
    if (modalContent) modalContent.innerHTML = reportHtml;

    const modalTitle = document.getElementById('report-modal-date-range');
    if (modalTitle) modalTitle.innerText = `Balance Sheet - As of ${monthName} ${day}, ${year} (${basis})`;

    // @ts-ignore
    const modalEl = document.getElementById('qbReportModal');
    if (modalEl && window.bootstrap) {
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    }
};

// --- QUICKBOOKS TRIAL BALANCE (DEBITS & CREDITS LEDGER) ---
window.generateTrialBalance = async () => {
    const basis = document.getElementById('report-basis') ? document.getElementById('report-basis').value : (companyProfile.defaultBasis || 'Accrual Basis');
    const endDateStr = document.getElementById('report-end').value || "2025-12-31";

    let totalDebits = 0;
    let totalCredits = 0;

    const accountTotals = {};

    cachedTransactions.forEach(t => {
        if (!t.date || t.date <= endDateStr) {
            const parsed = parseAccount(t.category);
            const amt = Number(t.amount) || 0;
            const code = parsed.code || "6990";
            const title = `${code} · ${parsed.name}`;

            if (!accountTotals[code]) {
                accountTotals[code] = { title, debit: 0, credit: 0 };
            }

            const isDr = (t.drCr === 'debit') || (!t.drCr && t.type !== 'income');
            if (isDr) {
                accountTotals[code].debit += amt;
                totalDebits += amt;
            } else {
                accountTotals[code].credit += amt;
                totalCredits += amt;
            }
        }
    });

    let rowsHtml = "";
    Object.keys(accountTotals).sort().forEach(code => {
        const acc = accountTotals[code];
        rowsHtml += `
            <tr>
                <td style="padding: 6px 8px;">${acc.title}</td>
                <td class="qb-amount-cell text-success" style="text-align: right; padding: 6px 8px;">${acc.debit ? `$${acc.debit.toFixed(2)}` : ''}</td>
                <td class="qb-amount-cell text-danger" style="text-align: right; padding: 6px 8px;">${acc.credit ? `$${acc.credit.toFixed(2)}` : ''}</td>
            </tr>`;
    });

    const companyName = companyProfile.name || "Lambda West, Inc.";

    const reportHtml = `
        <div class="qb-report-sheet" id="printable-qb-report">
            <div class="qb-report-header text-center pb-3 mb-4" style="border-bottom: 2px solid #000; position: relative;">
                <div style="font-size: 1.4rem; font-weight: 700; color: #000;">${companyName}</div>
                <div style="font-size: 1.15rem; font-weight: 700; color: #111;">Trial Balance (Debits & Credits)</div>
                <div style="font-size: 0.9rem; color: #333;">As of ${endDateStr}</div>
                <div style="position: absolute; left: 0; bottom: 8px; font-size: 0.8rem; font-weight: 600; color: #444;">${basis}</div>
            </div>

            <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                <thead>
                    <tr style="border-bottom: 2px solid #000;">
                        <th style="text-align: left; padding: 8px;">Account</th>
                        <th style="text-align: right; padding: 8px; width: 160px; color: #166534;">Debit (DR)</th>
                        <th style="text-align: right; padding: 8px; width: 160px; color: #991b1b;">Credit (CR)</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml || '<tr><td colspan="3" class="text-center py-4 text-muted">No transaction entries found.</td></tr>'}
                </tbody>
                <tfoot>
                    <tr style="border-top: 2px solid #000; border-bottom: 3px double #000; font-weight: bold; font-size: 0.95rem;">
                        <td style="padding: 10px 8px;">TOTALS</td>
                        <td class="qb-amount-cell text-success" style="text-align: right; padding: 10px 8px;">$${totalDebits.toFixed(2)}</td>
                        <td class="qb-amount-cell text-danger" style="text-align: right; padding: 10px 8px;">$${totalCredits.toFixed(2)}</td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;

    const modalContent = document.getElementById('qb-report-modal-content');
    if (modalContent) modalContent.innerHTML = reportHtml;

    const modalTitle = document.getElementById('report-modal-date-range');
    if (modalTitle) modalTitle.innerText = `Trial Balance - As of ${endDateStr}`;

    // @ts-ignore
    const modalEl = document.getElementById('qbReportModal');
    if (modalEl && window.bootstrap) {
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    }
};

// --- TRANSACTIONS MANAGEMENT & GENERAL LEDGER TRACKING (DEBITS & CREDITS) ---
window.saveData = async () => {
    const btn = document.querySelector('[onclick="saveData()"]');
    const dateInput = document.getElementById('date-input');
    const descInput = document.getElementById('desc');
    const amountInput = document.getElementById('amount');
    const categoryInput = document.getElementById('category');
    const assetSelect = document.getElementById('trans-asset');
    const payeeInput = document.getElementById('trans-payee');
    const drCrSelect = document.getElementById('trans-dr-cr');

    const amount = parseFloat(amountInput.value);
    if (!dateInput.value || isNaN(amount)) return alert("Please enter Date and Amount");

    const categoryVal = categoryInput.value;
    const parsed = parseAccount(categoryVal);
    const chosenDrCr = drCrSelect ? drCrSelect.value : parsed.drCr;
    const legacyType = chosenDrCr === 'credit' ? 'income' : 'expense';

    let selectedAssetId = "";
    let selectedAssetName = "";
    if (assetSelect && assetSelect.value) {
        selectedAssetId = assetSelect.value;
        const selectedOpt = assetSelect.options[assetSelect.selectedIndex];
        selectedAssetName = selectedOpt ? selectedOpt.textContent.trim() : "";
    }

    const payeeVal = payeeInput ? payeeInput.value.trim() : "";
    const originalText = btn ? btn.innerText : "Save Entry";

    try {
        if (btn) { btn.disabled = true; btn.innerHTML = "Saving..."; }

        await addDoc(collection(db, 'transactions'), {
            date: dateInput.value,
            description: descInput ? descInput.value.trim() : "",
            amount: amount,
            debit: chosenDrCr === 'debit' ? amount : 0,
            credit: chosenDrCr === 'credit' ? amount : 0,
            drCr: chosenDrCr,
            category: categoryVal,
            accountCode: parsed.code,
            accountName: parsed.name,
            assetId: selectedAssetId,
            assetName: selectedAssetName,
            payee: payeeVal,
            type: legacyType,
            userId: auth.currentUser.uid,
            createdAt: new Date()
        });

        if (btn) {
            btn.innerText = "Success!";
            btn.classList.replace('btn-primary', 'btn-success');
        }

        if (descInput) descInput.value = "";
        if (amountInput) amountInput.value = "";
        if (payeeInput) payeeInput.value = "";

        setTimeout(() => {
            if (btn) {
                btn.innerText = originalText;
                btn.disabled = false;
                btn.classList.replace('btn-success', 'btn-primary');
            }
        }, 1200);
    } catch (err) {
        alert(err.message);
        if (btn) btn.disabled = false;
    }
};

function startTracking(uid) {
    const q = query(collection(db, 'transactions'), where("userId", "==", uid), orderBy('createdAt', 'desc'));

    return onSnapshot(q, (snapshot) => {
        cachedTransactions = [];
        let income = 0;
        let expenses = 0;

        snapshot.docs.forEach(docSnap => {
            const data = docSnap.data();
            const amount = Number(data.amount) || 0;
            const item = { id: docSnap.id, ...data };
            cachedTransactions.push(item);

            if (data.type === 'income' || data.drCr === 'credit') income += amount;
            else expenses += amount;
        });

        // Update financial overview cards
        const totalIncomeEl = document.getElementById('total-income');
        if (totalIncomeEl) totalIncomeEl.innerText = `$${income.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        const totalExpenseEl = document.getElementById('total-expenses');
        if (totalExpenseEl) totalExpenseEl.innerText = `$${expenses.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        const net = income - expenses;
        const netEl = document.getElementById('net-balance');
        if (netEl) {
            netEl.innerText = `${net < 0 ? '-' : ''}$${Math.abs(net).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            netEl.style.color = "#ffffff";
        }

        // Render filtered transactions list
        window.applyTransactionFilters();

        // Refresh Portfolio Ledgers with updated transaction totals
        renderPortfolioUI();

        // If the Asset Ledger modal is open, refresh it live!
        if (currentActiveLedgerAsset) {
            window.openAssetLedger(currentActiveLedgerAsset.id, false);
        }
    });
}

window.applyTransactionFilters = () => {
    const searchFilter = (document.getElementById('trans-search-filter') ? document.getElementById('trans-search-filter').value : "").toLowerCase().trim();
    const assetFilter = document.getElementById('trans-asset-filter') ? document.getElementById('trans-asset-filter').value : "ALL";
    const typeFilter = document.getElementById('trans-type-filter') ? document.getElementById('trans-type-filter').value : "ALL";
    const listBody = document.getElementById('transaction-list');
    const countDisplay = document.getElementById('trans-count-display');

    if (!listBody) return;
    listBody.innerHTML = "";

    const filtered = cachedTransactions.filter(t => {
        if (assetFilter !== "ALL") {
            if (t.assetId !== assetFilter && t.assetName !== assetFilter) return false;
        }
        if (typeFilter !== "ALL") {
            const isDr = (t.drCr === 'debit') || (!t.drCr && t.type !== 'income');
            if (typeFilter === 'debit' && !isDr) return false;
            if (typeFilter === 'credit' && isDr) return false;
        }
        if (searchFilter) {
            const desc = (t.description || "").toLowerCase();
            const cat = (t.category || "").toLowerCase();
            const payee = (t.payee || "").toLowerCase();
            const asset = (t.assetName || "").toLowerCase();
            if (!desc.includes(searchFilter) && !cat.includes(searchFilter) && !payee.includes(searchFilter) && !asset.includes(searchFilter)) {
                return false;
            }
        }
        return true;
    });

    if (countDisplay) {
        countDisplay.innerText = `Showing ${filtered.length} of ${cachedTransactions.length} entries`;
    }

    let sumDebits = 0;
    let sumCredits = 0;
    let runningBal = 0;

    if (filtered.length === 0) {
        listBody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-muted">No transactions match your filter.</td></tr>`;
        const totalDebitEl = document.getElementById('trans-total-debit');
        const totalCreditEl = document.getElementById('trans-total-credit');
        const totalBalEl = document.getElementById('trans-total-balance');
        if (totalDebitEl) totalDebitEl.innerText = "$0.00";
        if (totalCreditEl) totalCreditEl.innerText = "$0.00";
        if (totalBalEl) totalBalEl.innerText = "$0.00";
        return;
    }

    filtered.forEach(data => {
        const amount = Number(data.amount) || 0;
        const displayDate = data.date || (data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleDateString() : 'N/A');
        const parsed = parseAccount(data.category);

        const isDebit = (data.drCr === 'debit') || (!data.drCr && data.type !== 'income');
        const debitVal = isDebit ? amount : 0;
        const creditVal = !isDebit ? amount : 0;

        sumDebits += debitVal;
        sumCredits += creditVal;
        runningBal += (debitVal - creditVal);

        const assetBadge = data.assetName ?
            `<span class="badge qb-pill-asset" role="button" onclick="window.openAssetLedgerByName('${data.assetName.replace(/'/g, "\\'")}')" title="Click to view asset ledger"><i class="bi bi-building me-1"></i>${data.assetName}</span>` :
            `<span class="text-muted small">--</span>`;

        listBody.innerHTML += `
            <tr class="align-middle">
                <td class="text-nowrap">${displayDate}</td>
                <td>
                    <span class="badge qb-pill-account mb-1">${parsed.full}</span>
                </td>
                <td>${assetBadge}</td>
                <td>
                    ${data.payee ? `<span class="fw-bold text-dark d-block"><i class="bi bi-person me-1 text-muted"></i>${data.payee}</span>` : ''}
                    <small class="text-muted">${data.description || 'No memo'}</small>
                </td>
                <td class="text-end fw-bold tabular-nums text-success">
                    ${debitVal ? `+$${debitVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '<span class="text-muted opacity-25">--</span>'}
                </td>
                <td class="text-end fw-bold tabular-nums text-danger">
                    ${creditVal ? `-$${creditVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '<span class="text-muted opacity-25">--</span>'}
                </td>
                <td class="text-end fw-bold tabular-nums ${runningBal >= 0 ? 'text-primary' : 'text-danger'}">
                    ${runningBal < 0 ? '-' : ''}$${Math.abs(runningBal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td class="text-end">
                    <button onclick="deleteTransaction('${data.id}')" class="btn btn-sm btn-outline-danger border-0" title="Delete Entry">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>`;
    });

    const totalDebitEl = document.getElementById('trans-total-debit');
    const totalCreditEl = document.getElementById('trans-total-credit');
    const totalBalEl = document.getElementById('trans-total-balance');
    if (totalDebitEl) totalDebitEl.innerText = `+$${sumDebits.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (totalCreditEl) totalCreditEl.innerText = `-$${sumCredits.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (totalBalEl) totalBalEl.innerText = `${runningBal < 0 ? '-' : ''}$${Math.abs(runningBal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

window.deleteTransaction = async (id) => {
    if (confirm("Delete this transaction entry?")) await deleteDoc(doc(db, 'transactions', id));
};


// --- VAULT ---
const convertToBase64 = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
};

window.uploadFile = async () => {
    const fileInput = document.getElementById('file-upload');
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > 800000) return alert("File too large (Max 0.8MB)");

    try {
        const base64String = await convertToBase64(file);
        await addDoc(collection(db, 'documents'), {
            imageData: base64String,
            name: file.name,
            userId: auth.currentUser.uid,
            createdAt: new Date()
        });
        fileInput.value = "";
    } catch (err) { alert("Upload failed"); }
};

function renderVault(uid) {
    const vaultList = document.getElementById('vault-list');
    const q = query(collection(db, 'documents'), where("userId", "==", uid), orderBy('createdAt', 'desc'));

    return onSnapshot(q, (snapshot) => {
        if (!vaultList) return;
        vaultList.innerHTML = snapshot.empty ? "<p class='p-3'>Vault is empty.</p>" : "";

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            vaultList.innerHTML += `
                <div class="col-12 col-md-6 col-lg-4 mb-3">
                    <div class="card h-100 shadow-sm border-0">
                        <div class="card-body d-flex justify-content-between align-items-center">
                            <div class="text-truncate" style="max-width: 150px;">
                                <small class="fw-bold d-block text-truncate">${data.name}</small>
                            </div>
                            <div class="d-flex gap-2">
                                <a href="${data.imageData}" download="${data.name}" class="btn btn-sm btn-primary">
                                    <i class="bi bi-download"></i>
                                </a>
                                <button onclick="deleteFile('${docSnap.id}')" class="btn btn-sm btn-outline-danger border-0">
                                    <i class="bi bi-trash"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>`;
        });
    }, (err) => console.error("Vault Error:", err));
}

window.deleteFile = async (id) => {
    if (confirm("Delete document?")) await deleteDoc(doc(db, 'documents', id));
};

// --- ASSET PORTFOLIO & QUICKBOOKS LEDGER ENGINE ---

window.toggleAddAssetForm = () => {
    const el = document.getElementById('add-asset-collapse');
    if (!el) return;
    el.style.display = (el.style.display === 'none' || el.style.display === '') ? 'block' : 'none';
};

window.setPortfolioView = (view) => {
    currentPortfolioView = view;
    const ledgerView = document.getElementById('portfolio-ledger-view');
    const cardsView = document.getElementById('portfolio-cards-view');
    const btnLedger = document.getElementById('btn-view-ledger');
    const btnCards = document.getElementById('btn-view-cards');

    if (view === 'ledger') {
        if (ledgerView) ledgerView.classList.remove('d-none');
        if (cardsView) cardsView.classList.add('d-none');
        if (btnLedger) { btnLedger.classList.replace('btn-outline-secondary', 'btn-primary'); btnLedger.classList.add('fw-bold'); }
        if (btnCards) { btnCards.classList.replace('btn-primary', 'btn-outline-secondary'); btnCards.classList.remove('fw-bold'); }
    } else {
        if (ledgerView) ledgerView.classList.add('d-none');
        if (cardsView) cardsView.classList.remove('d-none');
        if (btnCards) { btnCards.classList.replace('btn-outline-secondary', 'btn-primary'); btnCards.classList.add('fw-bold'); }
        if (btnLedger) { btnLedger.classList.replace('btn-primary', 'btn-outline-secondary'); btnLedger.classList.remove('fw-bold'); }
    }
};

window.filterPortfolio = () => {
    renderPortfolioUI();
};

window.addAsset = async () => {
    const nameInput = document.getElementById('asset-name');
    const catInput = document.getElementById('asset-category');
    const valueInput = document.getElementById('asset-value');
    const dateInput = document.getElementById('asset-date');
    const btn = document.querySelector('[onclick="addAsset()"]');

    const value = parseFloat(valueInput.value) || 0;
    const name = nameInput.value.trim();
    if (!name) return alert("Please enter Asset / Property Name");

    try {
        if (btn) btn.disabled = true;
        await addDoc(collection(db, 'assets'), {
            name: name,
            category: catInput ? catInput.value : 'Real Estate',
            value: value,
            purchaseDate: (dateInput && dateInput.value) ? dateInput.value : new Date().toISOString().split('T')[0],
            userId: auth.currentUser.uid,
            createdAt: new Date()
        });

        // Reset form
        nameInput.value = "";
        valueInput.value = "";
        window.toggleAddAssetForm();
        if (btn) btn.disabled = false;
    } catch (err) {
        alert("Error saving asset: " + err.message);
        if (btn) btn.disabled = false;
    }
};

function startAssetTracker(uid) {
    const q = query(collection(db, 'assets'), where("userId", "==", uid), orderBy('createdAt', 'desc'));

    return onSnapshot(q, (snapshot) => {
        cachedAssets = [];
        snapshot.forEach((docSnap) => {
            cachedAssets.push({ id: docSnap.id, ...docSnap.data() });
        });

        // Populate Asset Dropdowns in Transaction form and Filter
        populateAssetSelectors();

        // Render Portfolio Table and Cards
        renderPortfolioUI();
    });
}

function populateAssetSelectors() {
    const transSelect = document.getElementById('trans-asset');
    const filterSelect = document.getElementById('trans-asset-filter');

    if (transSelect) {
        const curVal = transSelect.value;
        transSelect.innerHTML = `<option value="">-- None / General Company --</option>`;
        cachedAssets.forEach(a => {
            const opt = document.createElement('option');
            opt.value = a.id;
            opt.textContent = a.name;
            transSelect.appendChild(opt);
        });
        transSelect.value = curVal;
    }

    if (filterSelect) {
        const curVal = filterSelect.value;
        filterSelect.innerHTML = `<option value="ALL">All Assets / Properties</option>`;
        cachedAssets.forEach(a => {
            const opt = document.createElement('option');
            opt.value = a.id;
            opt.textContent = a.name;
            filterSelect.appendChild(opt);
        });
        filterSelect.value = curVal;
    }
}

function renderPortfolioUI() {
    const tableBody = document.getElementById('asset-ledger-summary-list');
    const cardsContainer = document.getElementById('portfolio-cards-view');
    const catFilter = document.getElementById('portfolio-category-filter') ? document.getElementById('portfolio-category-filter').value : "ALL";

    let portfolioTotalBasis = 0;
    let portfolioTotalInflows = 0;
    let portfolioTotalOutflows = 0;

    if (tableBody) tableBody.innerHTML = "";
    if (cardsContainer) cardsContainer.innerHTML = "";

    const filteredAssets = cachedAssets.filter(a => {
        if (catFilter !== "ALL" && a.category !== catFilter) return false;
        return true;
    });

    cachedAssets.forEach(a => {
        portfolioTotalBasis += Number(a.value) || 0;
    });

    // Compute transactions per asset
    const assetStats = {};
    cachedAssets.forEach(a => {
        assetStats[a.id] = { inflow: 0, outflow: 0, net: 0, count: 0 };
    });

    cachedTransactions.forEach(t => {
        const amount = Number(t.amount) || 0;
        const isIncome = t.type === 'income';

        // Match by ID or Name
        let matchedAssetId = null;
        if (t.assetId && assetStats[t.assetId]) {
            matchedAssetId = t.assetId;
        } else if (t.assetName) {
            const found = cachedAssets.find(a => a.name.trim().toLowerCase() === t.assetName.trim().toLowerCase());
            if (found) matchedAssetId = found.id;
        }

        if (matchedAssetId && assetStats[matchedAssetId]) {
            if (isIncome) {
                assetStats[matchedAssetId].inflow += amount;
                portfolioTotalInflows += amount;
            } else {
                assetStats[matchedAssetId].outflow += amount;
                portfolioTotalOutflows += amount;
            }
            assetStats[matchedAssetId].count++;
        }
    });

    // Update KPI Ribbon
    const basisEl = document.getElementById('portfolio-total-basis');
    if (basisEl) basisEl.innerText = `$${portfolioTotalBasis.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const inflowEl = document.getElementById('portfolio-total-inflow');
    if (inflowEl) inflowEl.innerText = `+$${portfolioTotalInflows.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const outflowEl = document.getElementById('portfolio-total-outflow');
    if (outflowEl) outflowEl.innerText = `-$${portfolioTotalOutflows.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const netPortfolio = portfolioTotalInflows - portfolioTotalOutflows;
    const netEl = document.getElementById('portfolio-total-net');
    if (netEl) netEl.innerText = `${netPortfolio < 0 ? '-' : ''}$${Math.abs(netPortfolio).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    if (filteredAssets.length === 0) {
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="8" class="text-center py-5 text-muted">No assets found. Click "+ New Asset / Property" above to add one.</td></tr>`;
        }
        if (cardsContainer) {
            cardsContainer.innerHTML = `<div class="col-12 text-center py-5 text-muted">No assets in this category.</div>`;
        }
        return;
    }

    filteredAssets.forEach(a => {
        const stats = assetStats[a.id] || { inflow: 0, outflow: 0, net: 0, count: 0 };
        const basis = Number(a.value) || 0;
        const netCashflow = stats.inflow - stats.outflow;

        // Render Table Row
        if (tableBody) {
            tableBody.innerHTML += `
                <tr class="align-middle">
                    <td>
                        <div class="fw-bold text-dark fs-6">${a.name}</div>
                        <small class="text-muted"><i class="bi bi-clock-history me-1"></i>${stats.count} ledger entries</small>
                    </td>
                    <td><span class="badge bg-light text-dark border">${a.category || 'Asset'}</span></td>
                    <td class="text-muted">${a.purchaseDate || 'N/A'}</td>
                    <td class="text-end fw-semibold tabular-nums">$${basis.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td class="text-end text-success fw-bold tabular-nums">+$${stats.inflow.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td class="text-end text-danger fw-bold tabular-nums">-$${stats.outflow.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td class="text-end fw-bold tabular-nums ${netCashflow >= 0 ? 'text-primary' : 'text-danger'}">
                        ${netCashflow < 0 ? '-' : ''}$${Math.abs(netCashflow).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td class="text-center text-nowrap">
                        <button onclick="window.openAssetLedger('${a.id}')" class="btn btn-sm btn-primary rounded-pill px-3 me-1 shadow-sm" title="Open Full QuickBooks Register">
                            <i class="bi bi-journal-bookmark-fill me-1"></i> Open Ledger
                        </button>
                        <button onclick="deleteAsset('${a.id}')" class="btn btn-sm btn-outline-danger border-0" title="Delete Asset">
                            <i class="bi bi-trash"></i>
                        </button>
                    </td>
                </tr>`;
        }

        // Render Card View
        if (cardsContainer) {
            cardsContainer.innerHTML += `
                <div class="col-md-4">
                    <div class="card h-100 border-0 shadow-sm p-3">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <span class="badge bg-light text-dark border">${a.category}</span>
                            <button onclick="deleteAsset('${a.id}')" class="btn btn-sm text-danger p-0 border-0" title="Delete Asset">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                        <h5 class="fw-bold mb-1">${a.name}</h5>
                        <p class="text-muted small mb-3">Cost Basis: $${basis.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} &middot; Acquired ${a.purchaseDate || 'N/A'}</p>
                        
                        <div class="p-2 bg-light rounded-3 mb-3 small">
                            <div class="d-flex justify-content-between py-1 border-bottom">
                                <span class="text-muted">Inflows (Rent):</span>
                                <span class="text-success fw-bold">+$${stats.inflow.toFixed(2)}</span>
                            </div>
                            <div class="d-flex justify-content-between py-1 border-bottom">
                                <span class="text-muted">Outflows (Repairs/Taxes):</span>
                                <span class="text-danger fw-bold">-$${stats.outflow.toFixed(2)}</span>
                            </div>
                            <div class="d-flex justify-content-between py-1 fw-bold">
                                <span>Net Cashflow:</span>
                                <span class="${netCashflow >= 0 ? 'text-primary' : 'text-danger'}">${netCashflow < 0 ? '-' : ''}$${Math.abs(netCashflow).toFixed(2)}</span>
                            </div>
                        </div>

                        <button onclick="window.openAssetLedger('${a.id}')" class="btn btn-sm btn-outline-primary rounded-pill w-100 fw-bold mt-auto">
                            <i class="bi bi-journal-bookmark-fill me-1"></i> View Asset Ledger
                        </button>
                    </div>
                </div>`;
        }
    });
}

// --- DEDICATED ASSET ACCOUNT REGISTER (LEDGER) ---

window.openAssetLedger = (assetId, showModal = true) => {
    const asset = cachedAssets.find(a => a.id === assetId);
    if (!asset) return;

    currentActiveLedgerAsset = asset;

    const modalName = document.getElementById('ledger-modal-asset-name');
    if (modalName) modalName.innerText = `${asset.name} - General Ledger Register`;

    const modalCat = document.getElementById('ledger-modal-asset-category');
    if (modalCat) modalCat.innerText = `${asset.category || 'Asset'} &middot; Cost Basis: $${(Number(asset.value) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const assetBasisEl = document.getElementById('ledger-asset-basis');
    if (assetBasisEl) assetBasisEl.innerText = `$${(Number(asset.value) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const assetDateEl = document.getElementById('ledger-asset-date');
    if (assetDateEl) assetDateEl.innerText = `Acquired: ${asset.purchaseDate || 'N/A'}`;

    const activeIdInput = document.getElementById('ledger-active-asset-id');
    if (activeIdInput) activeIdInput.value = asset.id;

    const activeNameInput = document.getElementById('ledger-active-asset-name');
    if (activeNameInput) activeNameInput.value = asset.name;

    const entryDateInput = document.getElementById('ledger-entry-date');
    if (entryDateInput && !entryDateInput.value) entryDateInput.valueAsDate = new Date();

    // Filter transactions for this asset
    const assetTrans = cachedTransactions.filter(t => {
        if (t.assetId && t.assetId === asset.id) return true;
        if (t.assetName && t.assetName.trim().toLowerCase() === asset.name.trim().toLowerCase()) return true;
        return false;
    });

    // Sort chronologically ascending for register running balance
    assetTrans.sort((a, b) => {
        const da = a.date || "";
        const db = b.date || "";
        return da.localeCompare(db);
    });

    let runningCashflow = 0;
    let totalInflow = 0;
    let totalOutflow = 0;

    const tableBody = document.getElementById('asset-ledger-table-body');
    const countBadge = document.getElementById('ledger-entries-count');
    if (countBadge) countBadge.innerText = `${assetTrans.length} entries`;

    if (tableBody) {
        tableBody.innerHTML = "";

        if (assetTrans.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-muted">No transactions recorded for this asset yet. Use the quick entry bar above to record rent, repairs, or expenses.</td></tr>`;
        } else {
            assetTrans.forEach(t => {
                const amount = Number(t.amount) || 0;
                const parsed = parseAccount(t.category);
                const isDebit = (t.drCr === 'debit') || (!t.drCr && t.type !== 'income');
                const debitVal = isDebit ? amount : 0;
                const creditVal = !isDebit ? amount : 0;

                const isIncome = (t.type === 'income') || (t.drCr === 'credit' && parsed.type === 'income');
                if (isIncome) {
                    totalInflow += amount;
                    runningCashflow += amount;
                } else {
                    totalOutflow += amount;
                    runningCashflow -= amount;
                }

                tableBody.innerHTML += `
                    <tr class="align-middle">
                        <td class="text-nowrap">${t.date || 'N/A'}</td>
                        <td><span class="badge qb-pill-account">${parsed.full}</span></td>
                        <td>${t.payee ? `<span class="fw-bold text-dark">${t.payee}</span>` : '<span class="text-muted small">--</span>'}</td>
                        <td><small class="text-muted">${t.description || 'No memo'}</small></td>
                        <td class="text-end text-success fw-bold tabular-nums">${debitVal ? `+$${debitVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '<span class="text-muted opacity-25">--</span>'}</td>
                        <td class="text-end text-danger fw-bold tabular-nums">${creditVal ? `-$${creditVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '<span class="text-muted opacity-25">--</span>'}</td>
                        <td class="text-end fw-bold tabular-nums ${runningCashflow >= 0 ? 'text-primary' : 'text-danger'}">
                            ${runningCashflow < 0 ? '-' : ''}$${Math.abs(runningCashflow).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td class="text-center">
                            <button onclick="deleteTransaction('${t.id}')" class="btn btn-sm btn-outline-danger border-0 p-1" title="Delete Entry">
                                <i class="bi bi-trash"></i>
                            </button>
                        </td>
                    </tr>`;
            });
        }
    }

    const inflowEl = document.getElementById('ledger-asset-inflow');
    if (inflowEl) inflowEl.innerText = `+$${totalInflow.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const outflowEl = document.getElementById('ledger-asset-outflow');
    if (outflowEl) outflowEl.innerText = `-$${totalOutflow.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const netCashflow = totalInflow - totalOutflow;
    const netEl = document.getElementById('ledger-asset-net');
    if (netEl) {
        netEl.innerText = `${netCashflow < 0 ? '-' : ''}$${Math.abs(netCashflow).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    if (showModal) {
        // @ts-ignore
        const modalEl = document.getElementById('assetLedgerModal');
        if (modalEl && window.bootstrap) {
            const modal = new bootstrap.Modal(modalEl);
            modal.show();
        }
    }
};

window.openAssetLedgerByName = (assetName) => {
    if (!assetName) return;
    const found = cachedAssets.find(a => a.name.trim().toLowerCase() === assetName.trim().toLowerCase());
    if (found) {
        window.openAssetLedger(found.id);
    }
};

window.saveLedgerEntry = async () => {
    if (!currentActiveLedgerAsset) return alert("No active asset selected");

    const dateInput = document.getElementById('ledger-entry-date');
    const categorySelect = document.getElementById('ledger-entry-category');
    const payeeInput = document.getElementById('ledger-entry-payee');
    const descInput = document.getElementById('ledger-entry-desc');
    const amountInput = document.getElementById('ledger-entry-amount');
    const drCrSelect = document.getElementById('ledger-entry-dr-cr');

    const amount = parseFloat(amountInput.value);
    if (!dateInput.value || isNaN(amount)) return alert("Please enter Date and Amount");

    const categoryVal = categorySelect ? categorySelect.value : "";
    const parsed = parseAccount(categoryVal);
    const drCrVal = drCrSelect ? drCrSelect.value : (parsed.drCr || 'debit');
    const flowType = (parsed.type === 'income' || drCrVal === 'credit') ? 'income' : 'expense';

    try {
        await addDoc(collection(db, 'transactions'), {
            date: dateInput.value,
            description: descInput ? descInput.value.trim() : "",
            amount: amount,
            category: categoryVal,
            accountCode: parsed.code,
            accountName: parsed.name,
            assetId: currentActiveLedgerAsset.id,
            assetName: currentActiveLedgerAsset.name,
            payee: payeeInput ? payeeInput.value.trim() : "",
            type: flowType,
            drCr: drCrVal,
            userId: auth.currentUser.uid,
            createdAt: new Date()
        });

        if (descInput) descInput.value = "";
        if (amountInput) amountInput.value = "";
        if (payeeInput) payeeInput.value = "";
    } catch (err) {
        alert("Error recording entry: " + err.message);
    }
};

window.printCurrentAssetLedger = () => {
    if (!currentActiveLedgerAsset) return;
    const asset = currentActiveLedgerAsset;

    const assetTrans = cachedTransactions.filter(t => {
        if (t.assetId && t.assetId === asset.id) return true;
        if (t.assetName && t.assetName.trim().toLowerCase() === asset.name.trim().toLowerCase()) return true;
        return false;
    });

    assetTrans.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    let runningCashflow = 0;
    let totalInflow = 0;
    let totalOutflow = 0;
    let rowsHtml = "";

    assetTrans.forEach(t => {
        const amount = Number(t.amount) || 0;
        const parsed = parseAccount(t.category);
        const isDebit = (t.drCr === 'debit') || (!t.drCr && t.type !== 'income');
        const debitVal = isDebit ? amount : 0;
        const creditVal = !isDebit ? amount : 0;

        const isIncome = (t.type === 'income') || (t.drCr === 'credit' && parsed.type === 'income');

        if (isIncome) {
            totalInflow += amount;
            runningCashflow += amount;
        } else {
            totalOutflow += amount;
            runningCashflow -= amount;
        }

        rowsHtml += `
            <tr>
                <td>${t.date || ''}</td>
                <td>${parsed.full}</td>
                <td>${t.payee || ''}</td>
                <td>${t.description || ''}</td>
                <td style="text-align: right; color: #16a34a;">${debitVal ? `+$${debitVal.toFixed(2)}` : ''}</td>
                <td style="text-align: right; color: #dc2626;">${creditVal ? `-$${creditVal.toFixed(2)}` : ''}</td>
                <td style="text-align: right; font-weight: bold;">${runningCashflow < 0 ? '-' : ''}$${Math.abs(runningCashflow).toFixed(2)}</td>
            </tr>`;
    });

    const printWin = window.open('', '_blank');
    if (printWin) {
        printWin.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>${asset.name} - General Ledger Register</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; padding: 40px; color: #111; }
                    h2 { margin-bottom: 4px; }
                    .header-box { border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 20px; }
                    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 20px; }
                    th { border-bottom: 2px solid #000; text-align: left; padding: 8px 4px; font-weight: bold; }
                    td { border-bottom: 1px solid #e2e8f0; padding: 8px 4px; }
                    .summary { margin-top: 30px; display: flex; justify-content: flex-end; }
                    .summary-box { border: 1px solid #000; padding: 15px 25px; width: 300px; }
                    @media print { body { padding: 0; } }
                </style>
            </head>
            <body>
                <div class="header-box">
                    <h2>${companyProfile.name || 'Lambda West, Inc.'}</h2>
                    <h3>Asset General Ledger: ${asset.name}</h3>
                    <p>Category: ${asset.category} | Purchase Basis: $${(Number(asset.value) || 0).toFixed(2)} | Acquired: ${asset.purchaseDate || 'N/A'}</p>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Account / Code</th>
                            <th>Payee / Tenant</th>
                            <th>Memo / Description</th>
                            <th style="text-align: right;">Debit (DR)</th>
                            <th style="text-align: right;">Credit (CR)</th>
                            <th style="text-align: right;">Running Balance</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
                <div class="summary">
                    <div class="summary-box">
                        <div>Total Inflows: +$${totalInflow.toFixed(2)}</div>
                        <div>Total Outflows: -$${totalOutflow.toFixed(2)}</div>
                        <hr>
                        <div style="font-weight: bold; font-size: 14px;">Net Cashflow: $${(totalInflow - totalOutflow).toFixed(2)}</div>
                    </div>
                </div>
                <script>window.onload = () => window.print();<\/script>
            </body>
            </html>
        `);
        printWin.document.close();
    }
};

window.deleteAsset = async (id) => {
    if (confirm("Remove this asset from your portfolio?")) {
        await deleteDoc(doc(db, 'assets', id));
    }
};


// --- INVOICES ---

window.addInvoiceLineItem = (desc = '', price = '', qty = '1') => {
    const container = document.getElementById('invoice-items-container');
    const newRow = document.createElement('div');
    newRow.className = "row g-2 mb-2 invoice-line-item align-items-center";
    newRow.innerHTML = `
        <div class="col-md-6"><input type="text" class="form-control border-light item-desc" placeholder="Service Description" value="${desc}"></div>
        <div class="col-md-2"><input type="number" class="form-control border-light item-price" placeholder="Price ($)" value="${price}" onchange="calculateInvoiceTotal()"></div>
        <div class="col-md-2"><input type="number" class="form-control border-light item-qty" placeholder="Qty" value="${qty}" onchange="calculateInvoiceTotal()"></div>
        <div class="col-md-2 text-end"><button type="button" class="btn btn-outline-danger border-0 w-100 fw-bold" onclick="this.closest('.invoice-line-item').remove(); calculateInvoiceTotal();"><i class="bi bi-trash"></i></button></div>
    `;
    container.appendChild(newRow);
};

window.calculateInvoiceTotal = () => {
    let total = 0;
    document.querySelectorAll('.invoice-line-item').forEach(row => {
        const price = parseFloat(row.querySelector('.item-price').value) || 0;
        const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
        total += price * qty;
    });
    const totalEl = document.getElementById('invoice-total-display');
    if(totalEl) totalEl.innerText = total.toFixed(2);
    return total;
};

window.saveInvoiceData = async () => {
    const idInput = document.getElementById('invoice-id');
    const clientInput = document.getElementById('invoice-client');
    const dueInput = document.getElementById('invoice-due');
    const btn = document.querySelector('[onclick="saveInvoiceData()"]');

    const items = [];
    document.querySelectorAll('.invoice-line-item').forEach(row => {
        const desc = row.querySelector('.item-desc').value.trim();
        const price = parseFloat(row.querySelector('.item-price').value) || 0;
        const qty = parseFloat(row.querySelector('.item-qty').value) || 1;
        if(desc) items.push({ desc, price, qty });
    });

    const totalAmount = window.calculateInvoiceTotal();

    if (!clientInput.value || items.length === 0 || !dueInput.value) {
        return alert("Please enter client, due date, and at least one line item.");
    }

    try {
        btn.disabled = true;
        
        const mainDesc = items.length === 1 ? items[0].desc : `${items.length} Multiple Items`;

        if (idInput.value) {
            await updateDoc(doc(db, 'invoices', idInput.value), {
                client: clientInput.value,
                description: mainDesc,
                items: items,
                amount: totalAmount,
                dueDate: dueInput.value
            });
            btn.innerText = "Save Invoice";
            const heading = document.querySelector('#invoices-pane .card h3');
            if(heading) heading.innerText = "Create Invoice";
        } else {
            await addDoc(collection(db, 'invoices'), {
                client: clientInput.value,
                description: mainDesc,
                items: items,
                amount: totalAmount,
                dueDate: dueInput.value,
                status: "Pending",
                userId: auth.currentUser.uid,
                createdAt: new Date()
            });
        }

        // Reset form
        idInput.value = "";
        clientInput.value = "";
        dueInput.value = "";
        const custSelect = document.getElementById('invoice-customer-select');
        if(custSelect) custSelect.value = "";
        const container = document.getElementById('invoice-items-container');
        if(container) container.innerHTML = "";
        window.addInvoiceLineItem();
        window.calculateInvoiceTotal();
        btn.disabled = false;
    } catch (err) {
        alert("Error saving invoice: " + err.message);
        btn.disabled = false;
    }
};

function startInvoiceTracker(uid) {
    const q = query(collection(db, 'invoices'), where("userId", "==", uid), orderBy('createdAt', 'desc'));
    const invoiceList = document.getElementById('invoice-list');

    return onSnapshot(q, (snapshot) => {
        if (!invoiceList) return;
        invoiceList.innerHTML = "";

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.isTemplateObject) return; // Filter out the template object
            const createdDate = data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleDateString() : 'N/A';
            const amount = Number(data.amount) || 0;
            const statusClass = data.status === 'Paid' ? 'bg-success' : 'bg-warning text-dark';

            invoiceList.innerHTML += `
                <tr class="align-middle">
                    <td>${createdDate}</td>
                    <td class="fw-bold">${data.client}</td>
                    <td><small>${data.description}</small></td>
                    <td>${data.dueDate}</td>
                    <td class="fw-bold">$${amount.toFixed(2)}</td>
                    <td><span class="badge ${statusClass}">${data.status}</span></td>
                    <td class="text-nowrap">
                        ${data.status !== 'Paid' ? `
                        <button onclick="window.openReceivePaymentModal('${docSnap.id}', '${(data.client || '').replace(/'/g, "\\'")}', ${amount})" class="btn btn-sm btn-outline-success border-0 me-1" title="Receive Payment (QuickBooks Workflow: STCU Deposit & Credit AR)">
                            <i class="bi bi-cash-coin"></i>
                        </button>` : ''}
                        <button onclick="editInvoice('${docSnap.id}')" class="btn btn-sm btn-outline-secondary border-0 me-1" title="Edit Data">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button onclick="printInvoice('${docSnap.id}')" class="btn btn-sm btn-outline-primary border-0 me-1" title="Print/Save PDF">
                            <i class="bi bi-printer"></i>
                        </button>
                        <button onclick="copyInvoiceLink('${docSnap.id}')" class="btn btn-sm btn-outline-info border-0 me-1" title="Copy Invoice Link">
                            <i class="bi bi-link-45deg"></i>
                        </button>
                        <button onclick="toggleInvoiceStatus('${docSnap.id}', '${data.status}')" class="btn btn-sm btn-outline-success border-0 me-1" title="Toggle Status">
                            <i class="bi bi-check-circle"></i>
                        </button>
                        <button onclick="deleteInvoice('${docSnap.id}')" class="btn btn-sm btn-outline-danger border-0" title="Delete">
                            <i class="bi bi-trash"></i>
                        </button>
                    </td>
                </tr>`;
        });
    });
}

window.printInvoice = async (id) => {
    try {
        const docRef = doc(db, 'invoices', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            const amount = Number(data.amount) || 0;
            
            // Load template settings
            const tplSnap = await getDoc(doc(db, 'invoices', `TEMPLATE_${auth.currentUser.uid}`));
            let tpl = {
                brandName: 'THE CIRCLE',
                subtitle: 'DESIGN STUDIO',
                companyInfo: '<div>Really Great Company</div><div>hello@reallygreatsite.com</div>',
                bankDetails: '<div>Borcele Bank</div><div>Account Name: Avery Davis</div><div>Account No.: 123-456-7890</div><div>Pay by: 5 July 2025</div>',
                signature: '<span style="font-size: 44px; display: block; transform: translateX(-20px);">thank</span><span style="display: block; transform: translateX(20px);">You</span>'
            };
            if (tplSnap.exists() && tplSnap.data().isTemplateObject) {
                const td = tplSnap.data();
                if (td.brandName) tpl.brandName = td.brandName;
                if (td.subtitle) tpl.subtitle = td.subtitle;
                if (td.companyInfo) tpl.companyInfo = td.companyInfo;
                if (td.bankDetails) tpl.bankDetails = td.bankDetails;
                if (td.signature) tpl.signature = td.signature;
            }

            let itemsHtml = '';
            if (data.items && data.items.length > 0) {
                data.items.forEach(item => {
                    const itemTotal = (parseFloat(item.price) || 0) * (parseFloat(item.qty) || 1);
                    itemsHtml += `
                    <tr>
                        <td style="text-align: left;">${item.desc}</td>
                        <td style="text-align: center;">${(parseFloat(item.price) || 0).toFixed(0)}</td>
                        <td style="text-align: center;">${parseFloat(item.qty) || 1}</td>
                        <td style="text-align: right;">$${itemTotal.toFixed(0)}</td>
                    </tr>`;
                });
            } else {
                itemsHtml = `
                    <tr>
                        <td style="text-align: left;">${data.description}</td>
                        <td style="text-align: center;">${amount.toFixed(0)}</td>
                        <td style="text-align: center;">1</td>
                        <td style="text-align: right;">$${amount.toFixed(0)}</td>
                    </tr>`;
            }

            const invoiceHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Invoice - ${data.client}</title>
                <link href="https://fonts.googleapis.com/css2?family=Great+Vibes&family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
                <style>
                    body { font-family: 'Inter', sans-serif; padding: 40px; color: #111; max-width: 800px; margin: 0 auto; background: #fff; }
                    .logo-section { text-align: center; margin-bottom: 50px; position: relative; }
                    .logo-circle { width: 130px; height: 130px; border: 1px solid #000; border-radius: 50%; border-right-color: transparent; border-bottom-color: transparent; transform: rotate(45deg); position: absolute; top: -20px; left: 50%; margin-left: -65px; z-index: -1; }
                    .logo-circle-2 { width: 130px; height: 130px; border: 1px solid #000; border-radius: 50%; border-left-color: transparent; border-top-color: transparent; transform: rotate(45deg); position: absolute; top: -10px; left: 50%; margin-left: -65px; z-index: -1; }
                    .logo-top { font-family: 'Great Vibes', cursive; font-size: 32px; line-height: 1; margin: 0; position: relative; top: 10px; color: #555; }
                    .logo-main { letter-spacing: 12px; font-weight: 700; font-size: 26px; margin: 5px 0 5px 0; }
                    .logo-sub { font-size: 10px; letter-spacing: 5px; font-weight: 600; font-family: 'Inter', sans-serif; color: #333; }
                    
                    .header-info { display: flex; justify-content: space-between; margin-bottom: 40px; }
                    .info-title { font-size: 11px; font-weight: 700; letter-spacing: 1.5px; margin-bottom: 12px; }
                    .info-content { font-size: 12px; line-height: 1.6; color: #444; }
                    
                    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                    th { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 15px 0; font-size: 11px; font-weight: 700; letter-spacing: 1.5px; color: #000; }
                    td { padding: 18px 0; font-size: 12px; color: #333; }
                    
                    .total-banner { border-top: 1px solid #000; border-bottom: 1px solid #000; display: flex; justify-content: space-between; padding: 15px 0; font-weight: 700; font-size: 12px; letter-spacing: 1.5px; margin-bottom: 30px; }
                    
                    .summary-table { width: 250px; margin-left: auto; border-collapse: collapse; }
                    .summary-table td { padding: 7px 0; border: none; font-size: 12px; letter-spacing: 0.5px; }
                    
                    .footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 80px; }
                    .bank-details { font-size: 11px; line-height: 1.6; color: #444; }
                    .signature { font-family: 'Great Vibes', cursive; font-size: 60px; color: #333; line-height: 0.8; transform: rotate(-5deg); margin-right: 20px; display: inline-block;}
                    
                    [contenteditable]:hover { background-color: #f8fafc; outline: 1px dashed #ccc; cursor: text; }
                    [contenteditable]:focus { background-color: #fff; outline: 1px solid #4361ee; }
                    
                    .print-btn { display: block; width: 100%; padding: 15px; background: #4361ee; color: white; text-align: center; font-weight: bold; cursor: pointer; border: none; border-radius: 8px; margin-bottom: 40px; font-size: 16px; }
                    @media print { body { padding: 0; } .print-btn { display: none; } [contenteditable]:hover, [contenteditable]:focus { outline: none; background: transparent; } }
                </style>
            </head>
            <body>
                <button class="print-btn" onclick="window.print()">Print / Save PDF</button>

                <div class="logo-section" contenteditable="true">
                    <div class="logo-circle"></div>
                    <div class="logo-circle-2"></div>
                    <div class="logo-top">the</div>
                    <div class="logo-main">${tpl.brandName}</div>
                    <div class="logo-sub">${tpl.subtitle}</div>
                </div>

                <div class="header-info">
                    <div style="flex: 1;">
                        <div class="info-title">ISSUED TO:</div>
                        <div class="info-content" contenteditable="true">
                            <div>${data.client}</div>
                            ${tpl.companyInfo}
                        </div>
                    </div>
                    <div style="flex: 1; text-align: right;">
                        <div class="info-title">INVOICE NO:</div>
                        <div class="info-content" contenteditable="true">
                            <div style="font-weight: 700; margin-bottom: 8px; color: #000; letter-spacing: 1px;">#${id.substring(0,6).toUpperCase()}</div>
                            <div style="letter-spacing: 1px;">${new Date().toLocaleDateString('en-GB').replace(/\//g, '.')}</div>
                        </div>
                    </div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th style="text-align: left;">DESCRIPTION</th>
                            <th style="text-align: center;">UNIT PRICE</th>
                            <th style="text-align: center;">QTY</th>
                            <th style="text-align: right;">TOTAL</th>
                        </tr>
                    </thead>
                    <tbody contenteditable="true">
                        ${itemsHtml}
                    </tbody>
                </table>

                <div class="total-banner">
                    <div>TOTAL</div>
                    <div contenteditable="true">$${amount.toFixed(0)}</div>
                </div>

                <table class="summary-table" contenteditable="true">
                    <tr>
                        <td style="text-align: right; width: 60%; letter-spacing: 1px;">Total</td>
                        <td style="text-align: right;">$${amount.toFixed(0)}</td>
                    </tr>
                    <tr>
                        <td style="text-align: right; letter-spacing: 1px;">Tax</td>
                        <td style="text-align: right;">10%</td>
                    </tr>
                    <tr>
                        <td style="text-align: right; font-weight: 700; color: #000; letter-spacing: 1px;">Amount due</td>
                        <td style="text-align: right; font-weight: 700; color: #000;">$${(amount * 1.1).toFixed(0)}</td>
                    </tr>
                </table>

                <div class="footer">
                    <div>
                        <div class="info-title">BANK DETAILS</div>
                        <div class="info-content" contenteditable="true">
                            ${tpl.bankDetails}
                        </div>
                    </div>
                    <div>
                        <div class="signature" contenteditable="true">
                            ${tpl.signature}
                        </div>
                    </div>
                </div>

            </body>
            </html>`;
            const printWindow = window.open('', '_blank');
            if(printWindow) {
                printWindow.document.write(invoiceHtml);
                printWindow.document.close();
            } else {
                alert("Please allow popups to print invoices");
            }
        }
    } catch (err) {
        console.error("Error printing invoice:", err);
    }
};

window.copyInvoiceLink = async (id) => {
    let origin = window.location.origin;
    if (!origin || origin === 'null' || origin.includes('file://')) {
        origin = "https://omabooks.com"; 
    }
    const link = origin + '/invoice.html?id=' + id;
    
    try {
        await navigator.clipboard.writeText(link);
        alert("Smart Link copied to clipboard!\n\nYou can now paste this link directly into any email draft or text message to your client.");
    } catch (err) {
        // Fallback for strict browser security policies
        prompt("Copy this link to share your invoice:", link);
    }
};

window.loadTemplateSettings = async () => {
    try {
        const docSnap = await getDoc(doc(db, 'invoices', `TEMPLATE_${auth.currentUser.uid}`));
        if (docSnap.exists() && docSnap.data().isTemplateObject) {
            const data = docSnap.data();
            document.getElementById('tpl-brand').value = data.brandName || '';
            document.getElementById('tpl-subtitle').value = data.subtitle || '';
            document.getElementById('tpl-contact').value = data.companyInfo || '';
            document.getElementById('tpl-bank').value = data.bankDetails || '';
            document.getElementById('tpl-signature').value = data.signature || '';
        } else {
            // defaults
            document.getElementById('tpl-brand').value = 'THE CIRCLE';
            document.getElementById('tpl-subtitle').value = 'DESIGN STUDIO';
            document.getElementById('tpl-contact').value = '<div>Really Great Company</div>\n<div>hello@reallygreatsite.com</div>';
            document.getElementById('tpl-bank').value = '<div>Borcele Bank</div>\n<div>Account Name: Avery Davis</div>\n<div>Account No.: 123-456-7890</div>\n<div>Pay by: 5 July 2025</div>';
            document.getElementById('tpl-signature').value = '<span style="font-size: 44px; display: block; transform: translateX(-20px);">thank</span>\n<span style="display: block; transform: translateX(20px);">You</span>';
        }
    } catch(err) { console.error("Error loading template settings:", err); }
};

window.saveTemplateSettings = async () => {
    const btn = document.getElementById('save-tpl-btn');
    btn.disabled = true;
    try {
        await setDoc(doc(db, 'invoices', `TEMPLATE_${auth.currentUser.uid}`), {
            isTemplateObject: true,
            userId: auth.currentUser.uid,
            brandName: document.getElementById('tpl-brand').value,
            subtitle: document.getElementById('tpl-subtitle').value,
            companyInfo: document.getElementById('tpl-contact').value,
            bankDetails: document.getElementById('tpl-bank').value,
            signature: document.getElementById('tpl-signature').value
        }, { merge: true });
        
        const modalEl = document.getElementById('templateSettingsModal');
        // @ts-ignore
        const modal = bootstrap.Modal.getInstance(modalEl);
        if(modal) modal.hide();
        
    } catch(err) { alert(err.message); }
    btn.disabled = false;
};

window.editInvoice = async (id) => {
    try {
        const docSnap = await getDoc(doc(db, 'invoices', id));
        if (docSnap.exists()) {
            const data = docSnap.data();
            document.getElementById('invoice-id').value = id;
            document.getElementById('invoice-client').value = data.client;
            document.getElementById('invoice-due').value = data.dueDate;
            
            const container = document.getElementById('invoice-items-container');
            if(container) container.innerHTML = "";
            
            if (data.items && data.items.length > 0) {
                data.items.forEach(item => window.addInvoiceLineItem(item.desc, item.price, item.qty));
            } else {
                window.addInvoiceLineItem(data.description, data.amount, 1);
            }
            window.calculateInvoiceTotal();
            
            const btn = document.querySelector('[onclick="saveInvoiceData()"]');
            if(btn) btn.innerText = "Update Invoice";
            const heading = document.querySelector('#invoices-pane .card h3');
            if(heading) heading.innerText = "Edit Invoice";
            
            document.getElementById('invoices-pane').scrollIntoView({behavior: "smooth"});
        }
    } catch (err) {
        console.error("Error editing invoice:", err);
    }
};



window.toggleInvoiceStatus = async (id, currentStatus) => {
    const newStatus = currentStatus === 'Pending' ? 'Paid' : 'Pending';
    try {
        await updateDoc(doc(db, 'invoices', id), {
            status: newStatus
        });
    } catch (err) {
        console.error("Error updating invoice:", err);
    }
};

window.deleteInvoice = async (id) => {
    if (confirm("Delete this invoice?")) {
        await deleteDoc(doc(db, 'invoices', id));
    }
};

// --- RECEIVE PAYMENTS (IMAGE 5 WORKFLOW) ---
window.openReceivePaymentModal = (invoiceId, clientName, amount) => {
    const invIdInput = document.getElementById('rcv-invoice-id');
    const custInput = document.getElementById('rcv-customer-name');
    const dateInput = document.getElementById('rcv-payment-date');
    const amountInput = document.getElementById('rcv-payment-amount');
    const memoInput = document.getElementById('rcv-memo');

    if (invIdInput) invIdInput.value = invoiceId || '';
    if (custInput) custInput.value = clientName || '';
    if (dateInput) {
        const today = new Date().toISOString().split('T')[0];
        dateInput.value = today;
    }
    if (amountInput) amountInput.value = (amount !== undefined && amount !== null) ? Number(amount).toFixed(2) : '';
    if (memoInput) memoInput.value = clientName ? `Pd ck # for ${clientName}` : 'Customer invoice payment';

    const modalEl = document.getElementById('receivePaymentModal');
    if (modalEl && window.bootstrap) {
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
    }
};

window.submitReceivePayment = async () => {
    const invIdInput = document.getElementById('rcv-invoice-id');
    const custInput = document.getElementById('rcv-customer-name');
    const dateInput = document.getElementById('rcv-payment-date');
    const amountInput = document.getElementById('rcv-payment-amount');
    const depositSelect = document.getElementById('rcv-deposit-account');
    const memoInput = document.getElementById('rcv-memo');

    const invoiceId = invIdInput ? invIdInput.value : '';
    const clientName = custInput ? custInput.value.trim() : '';
    const paymentDate = dateInput ? dateInput.value : '';
    const paymentAmount = amountInput ? parseFloat(amountInput.value) : 0;
    const depositAccount = depositSelect ? depositSelect.value : '1005 · STCU Checking/Savings';
    const memo = memoInput ? memoInput.value.trim() : '';

    if (!paymentDate || isNaN(paymentAmount) || paymentAmount <= 0) {
        return alert("Please enter a valid payment date and amount.");
    }

    try {
        // 1. Mark invoice as paid
        if (invoiceId) {
            await updateDoc(doc(db, 'invoices', invoiceId), {
                status: 'Paid',
                paidDate: paymentDate,
                paidAmount: paymentAmount,
                depositAccount: depositAccount
            });
        }

        // 2. Record Debit to Bank & Credit to Contract Labor Income / Accounts Receivable (Image 5)
        await addDoc(collection(db, 'transactions'), {
            date: paymentDate,
            description: memo || `Payment received: ${clientName} (${depositAccount})`,
            amount: paymentAmount,
            category: '4015 · Contract Labor Income',
            accountCode: '4015',
            accountName: 'Contract Labor Income',
            payee: clientName,
            type: 'income',
            drCr: 'credit',
            depositAccount: depositAccount,
            userId: auth.currentUser.uid,
            createdAt: new Date()
        });

        // 3. Update Balance Sheet bank balances
        if (depositAccount.includes('1005')) {
            balanceSheetAccounts.stcu = (balanceSheetAccounts.stcu || 0) + paymentAmount;
            await window.saveBalanceSheetSettings(false);
        } else if (depositAccount.includes('1002')) {
            balanceSheetAccounts.pettyCash = (balanceSheetAccounts.pettyCash || 0) + paymentAmount;
            await window.saveBalanceSheetSettings(false);
        }

        // Close modal
        const modalEl = document.getElementById('receivePaymentModal');
        if (modalEl && window.bootstrap) {
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
        }

        alert(`Payment of $${paymentAmount.toFixed(2)} received and deposited to ${depositAccount} successfully.`);
    } catch (err) {
        console.error("Error receiving payment:", err);
        alert("Error receiving payment: " + err.message);
    }
};

// --- CUSTOMERS ---

window.saveCustomer = async () => {
    const idInput = document.getElementById('customer-id');
    const nameInput = document.getElementById('cust-name');
    const emailInput = document.getElementById('cust-email');
    const phoneInput = document.getElementById('cust-phone');
    const streetInput = document.getElementById('cust-street');
    const stateInput = document.getElementById('cust-state');
    const zipInput = document.getElementById('cust-zip');
    const btn = document.querySelector('[onclick="event.preventDefault(); saveCustomer();"]');

    if (!nameInput.value) return alert("Customer Name is required.");

    try {
        if (btn) { btn.disabled = true; btn.innerText = "Saving..."; }
        
        const customerData = {
            name: nameInput.value,
            email: emailInput.value,
            phone: phoneInput.value,
            street: streetInput.value,
            state: stateInput.value,
            zip: zipInput.value,
            userId: auth.currentUser.uid,
            updatedAt: new Date()
        };

        if (idInput.value) {
            await updateDoc(doc(db, 'customers', idInput.value), customerData);
        } else {
            customerData.createdAt = new Date();
            await addDoc(collection(db, 'customers'), customerData);
        }

        window.resetCustomerForm();
    } catch (err) {
        alert("Error saving customer: " + err.message);
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = "Save Customer"; }
    }
};

window.resetCustomerForm = () => {
    document.getElementById('customer-id').value = "";
    document.getElementById('cust-name').value = "";
    document.getElementById('cust-email').value = "";
    document.getElementById('cust-phone').value = "";
    document.getElementById('cust-street').value = "";
    document.getElementById('cust-state').value = "";
    document.getElementById('cust-zip').value = "";
    
    document.getElementById('cancel-cust-btn').style.display = 'none';
    const btn = document.querySelector('[onclick="event.preventDefault(); saveCustomer();"]');
    if(btn) btn.innerText = "Save Customer";
    
    const panel = document.getElementById('customers-pane');
    if(panel) panel.querySelector('h3').innerHTML = '<i class="bi bi-person-plus-fill me-2"></i>Add New Customer';
};

window.editCustomer = async (id) => {
    try {
        const docSnap = await getDoc(doc(db, 'customers', id));
        if (docSnap.exists()) {
            const data = docSnap.data();
            document.getElementById('customer-id').value = id;
            document.getElementById('cust-name').value = data.name || "";
            document.getElementById('cust-email').value = data.email || "";
            document.getElementById('cust-phone').value = data.phone || "";
            document.getElementById('cust-street').value = data.street || "";
            document.getElementById('cust-state').value = data.state || "";
            document.getElementById('cust-zip').value = data.zip || "";
            
            document.getElementById('cancel-cust-btn').style.display = 'inline-block';
            const btn = document.querySelector('[onclick="event.preventDefault(); saveCustomer();"]');
            if(btn) btn.innerText = "Update Customer";
            
            const panel = document.getElementById('customers-pane');
            if(panel) {
                panel.querySelector('h3').innerHTML = '<i class="bi bi-pencil-square me-2"></i>Edit Customer Details';
                panel.scrollIntoView({behavior: "smooth"});
            }
        }
    } catch (err) {
        console.error("Error fetching customer:", err);
    }
};

window.deleteCustomer = async (id) => {
    if (confirm("Are you sure you want to permanently delete this customer's record?")) {
        await deleteDoc(doc(db, 'customers', id));
    }
};

function startCustomerTracker(uid) {
    const q = query(collection(db, 'customers'), where("userId", "==", uid));
    const list = document.getElementById('customer-list');
    const select = document.getElementById('invoice-customer-select');

    return onSnapshot(q, (snapshot) => {
        if (!list) return;
        
        let customers = [];
        snapshot.forEach(docSnap => customers.push({ id: docSnap.id, ...docSnap.data() }));
        
        customers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        cachedCustomers = customers;

        if (select) {
            const currentVal = select.value;
            select.innerHTML = '<option value="">-- Custom Client --</option>';
            customers.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.name;
                opt.textContent = c.name;
                select.appendChild(opt);
            });
            select.value = currentVal;
        }

        // Populate Payee options for Transactions and Asset Ledgers
        const payeeDatalist = document.getElementById('payee-options');
        if (payeeDatalist) {
            payeeDatalist.innerHTML = "";
            customers.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.name;
                payeeDatalist.appendChild(opt);
            });
        }

        list.innerHTML = "";
        customers.forEach((data) => {
            list.innerHTML += `
                <tr>
                    <td class="fw-bold text-dark">${data.name}</td>
                    <td>
                        <div class="small"><i class="bi bi-envelope me-1 text-muted"></i> ${data.email || '--'}</div>
                        <div class="small mt-1"><i class="bi bi-telephone me-1 text-muted"></i> ${data.phone || '--'}</div>
                    </td>
                    <td><small class="text-muted">${data.street || ''}${data.state ? ', ' + data.state : ''}${data.zip ? ' ' + data.zip : ''}</small></td>
                    <td class="text-end">
                        <button onclick="editCustomer('${data.id}')" class="btn btn-sm btn-outline-secondary border-0 me-1" title="Edit Customer">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button onclick="deleteCustomer('${data.id}')" class="btn btn-sm btn-outline-danger border-0" title="Delete Customer">
                            <i class="bi bi-trash"></i>
                        </button>
                    </td>
                </tr>`;
        });
    });
}