/** A strict amount parser: only decimal text can enter posted INR books. */
export function toPaise(amount) {
  if (typeof amount !== 'string' && typeof amount !== 'number') {
    throw new TypeError('Monetary amount must be a decimal string or finite number');
  }
  const text = String(amount);
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(text)) {
    throw new RangeError('Amount must be a nonnegative decimal with at most two paise digits');
  }
  const [whole, fraction = ''] = text.split('.');
  const paise = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  if (paise > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Amount exceeds maximum safe integer paise');
  }
  return Number(paise);
}

export function fromPaise(amount) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError('Paise must be a safe nonnegative integer');
  return `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`;
}
