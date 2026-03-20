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

// --- AUTHENTICATION ---
onAuthStateChanged(auth, (user) => {
    const authContainer = document.getElementById('auth-container');
    const appContent = document.getElementById('app-content');

    if (user) {
        authContainer.classList.replace('d-flex', 'd-none');
        appContent.classList.remove('d-none');
        appContent.style.display = 'block';

        const datePicker = document.getElementById('date-input');
        if (datePicker) datePicker.valueAsDate = new Date();

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

// --- REPORT GENERATION ---
window.generateReport = async () => {
    const start = document.getElementById('report-start').value;
    const end = document.getElementById('report-end').value;

    if (!start || !end) {
        alert("Please select both a start and end date.");
        return;
    }

    const q = query(
        collection(db, 'transactions'),
        where("userId", "==", auth.currentUser.uid),
        where("date", ">=", start),
        where("date", "<=", end),
        orderBy("date", "asc")
    );

    try {
        const querySnapshot = await getDocs(q);
        let totalIncome = 0;
        let totalExpense = 0;
        let tableRowsHtml = "";

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const amount = Number(data.amount) || 0;
            const isIncome = data.type === 'income';

            if (isIncome) totalIncome += amount;
            else totalExpense += amount;

            tableRowsHtml += `
                <tr>
                    <td>${data.date}</td>
                    <td>${data.category || 'General'}</td>
                    <td>${data.description}</td>
                    <td class="${data.type === 'income' ? 'income' : 'expense'}">$${amount.toFixed(2)}</td>
                </tr>`;
        });

        let reportHtml = `
            <html>
            <head>
                <title>OmaBooks Statement</title>
                <style>
                    body { font-family: sans-serif; padding: 40px; color: #1e293b; }
                    h1 { color: #4361ee; }
                    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                    th { text-align: left; background: #f8fafc; padding: 12px; border-bottom: 2px solid #e2e8f0; }
                    td { padding: 12px; border-bottom: 1px solid #e2e8f0; }
                    .income { color: #10b981; font-weight: bold; }
                    .expense { color: #ef4444; font-weight: bold; }
                    .summary { margin-top: 30px; padding: 20px; background: #f8fafc; border-radius: 12px; display: inline-block; min-width: 250px; }
                </style>
            </head>
            <body>
                <h1>Financial Report</h1>
                <p>Period: ${start} to ${end}</p>
                <table>
                    <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead>
                    <tbody>${tableRowsHtml}</tbody>
                </table>
                <div class="summary">
                    <p>Total Income: <span class="income">+$${totalIncome.toFixed(2)}</span></p>
                    <p>Total Expenses: <span class="expense">-$${totalExpense.toFixed(2)}</span></p>
                    <hr>
                    <h3>Net Balance: $${(totalIncome - totalExpense).toFixed(2)}</h3>
                </div>
                <script>window.onload = () => window.print();</script>
            </body></html>`;

        const reportWindow = window.open('', '_blank');
        reportWindow.document.write(reportHtml);
        reportWindow.document.close();
    } catch (error) {
        console.error(error);
        alert("Check console - you likely need to create a Firestore Index for this date range.");
    }
};

// --- TRANSACTIONS ---
window.saveData = async () => {
    const btn = document.querySelector('[onclick="saveData()"]');
    const dateInput = document.getElementById('date-input');
    const descInput = document.getElementById('desc');
    const amountInput = document.getElementById('amount');
    const categoryInput = document.getElementById('category');

    const amount = parseFloat(amountInput.value);
    if (!dateInput.value || !descInput.value || isNaN(amount)) return alert("Fill all fields");

    const originalText = btn.innerText;
    const type = (categoryInput.value === "Rental Income") ? "income" : "expense";

    try {
        btn.disabled = true;
        btn.innerHTML = "Saving...";

        await addDoc(collection(db, 'transactions'), {
            date: dateInput.value,
            description: descInput.value,
            amount: amount,
            category: categoryInput.value,
            type: type,
            userId: auth.currentUser.uid,
            createdAt: new Date()
        });

        btn.innerText = "Success!";
        btn.classList.replace('btn-primary', 'btn-success');
        descInput.value = "";
        amountInput.value = "";

        setTimeout(() => {
            btn.innerText = originalText;
            btn.disabled = false;
            btn.classList.replace('btn-success', 'btn-primary');
        }, 1500);
    } catch (err) { alert(err.message); btn.disabled = false; }
};

function startTracking(uid) {
    const q = query(collection(db, 'transactions'), where("userId", "==", uid), orderBy('createdAt', 'desc'));

    return onSnapshot(q, (snapshot) => {
        let income = 0; let expenses = 0;
        const listBody = document.getElementById('transaction-list');
        if (listBody) listBody.innerHTML = "";

        snapshot.docs.forEach(docSnap => {
            const data = docSnap.data();
            const amount = Number(data.amount) || 0;
            data.type === 'income' ? income += amount : expenses += amount;

            let displayDate = data.date || (data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleDateString() : 'N/A');

            if (listBody) {
                listBody.innerHTML += `
                <tr class="align-middle">
                    <td>${displayDate}</td>
                    <td><strong>${data.category}</strong><br><small>${data.description}</small></td>
                    <td class="fw-bold ${data.type === 'income' ? 'text-success' : 'text-danger'}">
                        ${data.type === 'income' ? '+' : '-'}$${amount.toFixed(2)}
                    </td>
                    <td><span class="badge ${data.type === 'income' ? 'bg-success' : 'bg-danger'}">${data.type.toUpperCase()}</span></td>
                    <td>
                        <button onclick="deleteTransaction('${docSnap.id}')" class="btn btn-sm btn-outline-danger border-0">
                            <i class="bi bi-trash"></i>
                        </button>
                    </td>
                </tr>`;
            }
        });

        document.getElementById('total-income').innerText = `$${income.toFixed(2)}`;
        document.getElementById('total-expenses').innerText = `$${expenses.toFixed(2)}`;
        const net = income - expenses;
        const netEl = document.getElementById('net-balance');
        netEl.innerText = `$${net.toFixed(2)}`;
        netEl.style.color = net >= 0 ? "#4361ee" : "#ef4444";
    });
}

window.deleteTransaction = async (id) => {
    if (confirm("Delete record?")) await deleteDoc(doc(db, 'transactions', id));
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

// --- ASSET MANAGER ---

window.addAsset = async () => {
    const nameInput = document.getElementById('asset-name');
    const catInput = document.getElementById('asset-category');
    const valueInput = document.getElementById('asset-value');
    const dateInput = document.getElementById('asset-date');
    const btn = document.querySelector('[onclick="addAsset()"]');

    const value = parseFloat(valueInput.value);
    if (!nameInput.value || isNaN(value)) return alert("Please enter Asset Name and Value");

    try {
        btn.disabled = true;
        await addDoc(collection(db, 'assets'), {
            name: nameInput.value,
            category: catInput.value,
            value: value,
            purchaseDate: dateInput.value || new Date().toISOString().split('T')[0],
            userId: auth.currentUser.uid,
            createdAt: new Date()
        });

        // Reset form
        nameInput.value = "";
        valueInput.value = "";
        btn.disabled = false;
    } catch (err) {
        alert("Error saving asset: " + err.message);
        btn.disabled = false;
    }
};

function startAssetTracker(uid) {
    const q = query(collection(db, 'assets'), where("userId", "==", uid), orderBy('createdAt', 'desc'));
    const assetGrid = document.getElementById('asset-grid');

    return onSnapshot(q, (snapshot) => {
        if (!assetGrid) return;
        assetGrid.innerHTML = "";
        let totalAssetValue = 0;

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const val = Number(data.value) || 0;
            totalAssetValue += val;

            assetGrid.innerHTML += `
                <div class="col-md-4">
                    <div class="card h-100 border-0 shadow-sm p-3">
                        <div class="d-flex justify-content-between">
                            <span class="badge bg-light text-dark mb-2">${data.category}</span>
                            <button onclick="deleteAsset('${docSnap.id}')" class="btn btn-sm text-danger p-0">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                        <h5 class="fw-bold mb-1">${data.name}</h5>
                        <p class="text-primary fw-800 fs-4 mb-0">$${val.toLocaleString()}</p>
                        <small class="text-muted">Acquired: ${data.purchaseDate}</small>
                    </div>
                </div>`;
        });

        // Optional: If you want to show "Total Assets" somewhere, you can update a UI element here
        console.log("Total Asset Portfolio Value: ", totalAssetValue);
    });
}

window.deleteAsset = async (id) => {
    if (confirm("Remove this asset from Oma's portfolio?")) {
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
                    <td>
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

    return onSnapshot(q, (snapshot) => {
        if (!list) return;
        
        let customers = [];
        snapshot.forEach(docSnap => customers.push({ id: docSnap.id, ...docSnap.data() }));
        
        customers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

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