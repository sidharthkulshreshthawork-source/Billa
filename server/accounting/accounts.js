import { randomUUID } from 'node:crypto';
import { transaction } from './sqlite.js';

// Stable codes, jurisdiction-specific account mapping above a generic ledger.
const DEFAULT_ACCOUNTS = [
  ['1000', 'Cash on Hand', 'asset', 'debit'],
  ['1010', 'Bank Account', 'asset', 'debit'],
  ['1100', 'Trade Receivables', 'asset', 'debit'],
  ['1200', 'Inventory', 'asset', 'debit'],
  ['1300', 'Input CGST', 'asset', 'debit'],
  ['1310', 'Input SGST', 'asset', 'debit'],
  ['1320', 'Input IGST', 'asset', 'debit'],
  ['1330', 'Input UTGST', 'asset', 'debit'],
  ['1340', 'Input Cess', 'asset', 'debit'],
  ['1500', 'Other Current Assets', 'asset', 'debit'],
  ['2000', 'Trade Payables', 'liability', 'credit'],
  ['2100', 'Output CGST', 'liability', 'credit'],
  ['2110', 'Output SGST', 'liability', 'credit'],
  ['2120', 'Output IGST', 'liability', 'credit'],
  ['2130', 'Output UTGST', 'liability', 'credit'],
  ['2140', 'Output Cess', 'liability', 'credit'],
  ['2150', 'Other Taxes Payable', 'liability', 'credit'],
  ['2200', 'Loans and Borrowings', 'liability', 'credit'],
  ['3000', 'Owner Capital', 'equity', 'credit'],
  ['3100', 'Retained Earnings', 'equity', 'credit'],
  ['4000', 'Service Revenue', 'income', 'credit'],
  ['4010', 'Goods Sales Revenue', 'income', 'credit'],
  ['4100', 'Other Operating Income', 'income', 'credit'],
  ['5000', 'Cost of Goods Sold', 'expense', 'debit'],
  ['6000', 'General Operating Expenses', 'expense', 'debit'],
  ['6100', 'Rent Expense', 'expense', 'debit'],
  ['6200', 'Salaries and Wages', 'expense', 'debit'],
  ['6300', 'Utilities Expense', 'expense', 'debit'],
  ['6400', 'Bank Charges', 'expense', 'debit'],
  ['6500', 'Depreciation Expense', 'expense', 'debit'],
];

export function seedBusinessAccounts(db, businessId) {
  const exists = db.prepare('SELECT id FROM businesses WHERE id=?').get(businessId);
  if (!exists) throw new Error(`business not found: ${businessId}`);
  const insert = db.prepare(`INSERT INTO accounts(id,business_id,account_code,name,kind,normal_balance)
    VALUES (?,?,?,?,?,?) ON CONFLICT(business_id,account_code) DO NOTHING`);
  const seed = () => {
    for (const [code, name, kind, normal] of DEFAULT_ACCOUNTS) {
      insert.run(randomUUID(), businessId, code, name, kind, normal);
    }
  };
  if (db.isTransaction) seed();
  else transaction(db, seed);
  return DEFAULT_ACCOUNTS.map(([code]) => code);
}

export function getAccountId(db, businessId, code) {
  const row = db.prepare('SELECT id FROM accounts WHERE business_id=? AND account_code=?').get(businessId, code);
  if (!row) throw new Error(`business/account not found: ${businessId}/${code}`);
  return row.id;
}
