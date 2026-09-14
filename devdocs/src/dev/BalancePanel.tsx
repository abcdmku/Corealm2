import { FormulaWorkspace } from './formulas/FormulaWorkspace.js';
import './balance.css';
export default function BalancePanel(props: { collection: string; recordId?: string }) { return <div className="balance-panel"><FormulaWorkspace {...props} /></div>; }
