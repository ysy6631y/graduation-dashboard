// Budget data is optional in legacy workspace snapshots. All amounts are integer KRW.
export const budgetProjects = ['LUUM', '리비두비'];
export const budgetStatuses = {inquiry: '문의 중', comparing: '비교 중', confirmed: '확정'};
export const MAX_AMOUNT = 1_000_000_000;
export const cleanTitle = title => String(title).replace(/[ \t\r\n]+/g, ' ').trim();
export const itemKey = (project, title) => project + ':' + cleanTitle(title).toLowerCase();
export const emptyBudget = () => ({version: 1, settings: [], items: [], quotes: []});
export const budgetOf = state => state.budget || emptyBudget();
export const ensureBudget = state => state.budget ||= emptyBudget();
export const projectSetting = (state, project) => budgetOf(state).settings.find(s => s.id === project) || {id: project, perPerson: 0, members: 4};
export const itemQuotes = (state, itemId) => budgetOf(state).quotes.filter(q => q.itemId === itemId && !q.deletedAt);
export const projectItems = (state, project) => budgetOf(state).items.filter(i => i.project === project && itemQuotes(state, i.id).length);
export function itemAmount(state, item) {
  const quotes = itemQuotes(state, item.id);
  const selected = quotes.find(q => q.id === item.decision.quoteId);
  return selected ? selected.amount : quotes.length ? Math.min(...quotes.map(q => q.amount)) : 0;
}
export function budgetSummary(state, project) {
  const {perPerson, members} = projectSetting(state, project);
  const total = perPerson * members;
  const confirmed = projectItems(state, project).filter(i => i.decision.status === 'confirmed').reduce((sum, item) => sum + itemAmount(state, item), 0);
  return {perPerson, members, total, confirmed, remaining: total - confirmed};
}
export function upsertQuote(state, project, values, quoteId = crypto.randomUUID()) {
  const budget = ensureBudget(state), title = cleanTitle(values.title), key = itemKey(project, title);
  let item = budget.items.find(i => i.id === key);
  if (!item) {
    item = {id: key, project, title, decision: {status: 'comparing', quoteId: null}};
    budget.items.push(item);
  }
  const existing = budget.quotes.find(q => q.id === quoteId);
  if (existing && existing.itemId !== key) {
    const previous = budget.items.find(i => i.id === existing.itemId);
    if (previous.decision.quoteId === quoteId) previous.decision = {status: 'comparing', quoteId: null};
  }
  const quote = {id: quoteId, itemId: key, amount: values.amount, vendor: values.vendor || '', url: values.url || '', memo: values.memo || '', deletedAt: null};
  if (existing) Object.assign(existing, quote); else budget.quotes.push(quote);
  return key;
}
export function setDecision(state, itemId, status, quoteId = null) {
  const item = ensureBudget(state).items.find(i => i.id === itemId);
  if (!item || !itemQuotes(state, itemId).length) throw Error('삭제된 제작물이에요. 최신 목록을 확인해주세요.');
  if (status === 'confirmed' && !itemQuotes(state, itemId).some(q => q.id === quoteId)) throw Error('확정할 견적을 선택해주세요.');
  item.decision = {status, quoteId: status === 'confirmed' ? quoteId : null};
}
export function removeQuote(state, quoteId) {
  const budget = ensureBudget(state), quote = budget.quotes.find(q => q.id === quoteId && !q.deletedAt);
  if (!quote) throw Error('이미 삭제된 견적이에요.');
  quote.deletedAt = new Date().toISOString();
  const item = budget.items.find(i => i.id === quote.itemId);
  if (item.decision.quoteId === quoteId) item.decision = {status: 'comparing', quoteId: null};
}
export function validBudget(budget, safeURL) {
  if (budget === undefined) return true;
  if (!budget || budget.version !== 1 || !['settings','items','quotes'].every(k => Array.isArray(budget[k]))) return false;
  if (budget.settings.length > 2 || budget.items.length > 1000 || budget.quotes.length > 2000) return false;
  for (const key of ['settings','items','quotes']) if (new Set(budget[key].map(v => v?.id)).size !== budget[key].length) return false;
  const amount = n => Number.isSafeInteger(n) && n >= 0 && n <= MAX_AMOUNT;
  if (!budget.settings.every(s => s && budgetProjects.includes(s.id) && amount(s.perPerson) && Number.isInteger(s.members) && s.members >= 1 && s.members <= 1000)) return false;
  if (!budget.items.every(i => i && budgetProjects.includes(i.project) && typeof i.title === 'string' && cleanTitle(i.title) === i.title && i.title.length > 0 && i.title.length <= 100 && i.id === itemKey(i.project,i.title) && i.decision && Object.hasOwn(budgetStatuses,i.decision.status) && (i.decision.status === 'confirmed' ? typeof i.decision.quoteId === 'string' : i.decision.quoteId === null))) return false;
  if (!budget.quotes.every(q => q && typeof q.id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(q.id) && budget.items.some(i => i.id === q.itemId) && amount(q.amount) && ['vendor','url','memo'].every(k => typeof q[k] === 'string') && q.vendor.length <= 100 && q.memo.length <= 300 && q.url.length <= 4000 && safeURL(q.url) && (q.deletedAt === null || typeof q.deletedAt === 'string' && Number.isFinite(Date.parse(q.deletedAt))))) return false;
  return budget.items.every(i => i.decision.status !== 'confirmed' || budget.quotes.some(q => q.id === i.decision.quoteId && q.itemId === i.id && !q.deletedAt));
}
