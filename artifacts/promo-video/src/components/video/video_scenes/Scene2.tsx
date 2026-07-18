import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { AppShell, Cursor, Kicker } from './SharedUI';
import { Scale, AlertTriangle, ArrowRight } from 'lucide-react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2000), // Exclusions
      setTimeout(() => setPhase(3), 5000), // Compliance snapshot
      setTimeout(() => setPhase(4), 8000), // Cursor move
      setTimeout(() => setPhase(5), 10000), // Click next
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const getCursorPos = () => {
    if (phase < 4) return { x: '80vw', y: '80vh' };
    if (phase >= 4) return { x: '75vw', y: '65vh' }; // Over Next button
    return { x: '80vw', y: '80vh' };
  };

  return (
    <motion.div className="absolute inset-0 bg-background" exit={{ opacity: 0 }}>
      <AppShell activePath="/notices">
        <div className="p-[3vw] max-w-[65vw] mx-auto space-y-[2vw]">
          <div className="flex items-center gap-[1vw]">
            <h1 className="text-[2.5vw] font-display font-bold tracking-tight">Prepare Notice</h1>
          </div>
          
          <div className="border border-border rounded-[0.5vw] bg-card overflow-hidden">
            <div className="border-b border-border p-[1.5vw] flex items-center gap-[1vw]">
              <Scale className="w-[1.5vw] h-[1.5vw] text-primary" />
              <h2 className="text-[1.2vw] font-bold">Rent-Only Calculation Review</h2>
            </div>
            
            <div className="p-[1.5vw] space-y-[2vw]">
              <table className="w-full text-[0.9vw]">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="pb-[1vw] text-left">Month</th>
                    <th className="pb-[1vw] text-right">Rent charged</th>
                    <th className="pb-[1vw] text-right">Payments</th>
                    <th className="pb-[1vw] text-right">Credits</th>
                    <th className="pb-[1vw] text-right font-bold">Rent-only balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/50">
                    <td className="py-[1vw] font-medium">September 2023</td>
                    <td className="py-[1vw] text-right">$2,400.00</td>
                    <td className="py-[1vw] text-right">$2,400.00</td>
                    <td className="py-[1vw] text-right">$0.00</td>
                    <td className="py-[1vw] text-right font-display font-bold text-muted-foreground">$0.00</td>
                  </tr>
                  <tr className="border-b border-border/50 bg-primary/5">
                    <td className="py-[1vw] font-medium">October 2023</td>
                    <td className="py-[1vw] text-right">$2,400.00</td>
                    <td className="py-[1vw] text-right">$0.00</td>
                    <td className="py-[1vw] text-right">$0.00</td>
                    <td className="py-[1vw] text-right font-display font-bold">$2,400.00</td>
                  </tr>
                  <tr className="bg-primary/5">
                    <td className="py-[1vw] font-medium">November 2023</td>
                    <td className="py-[1vw] text-right">$2,400.00</td>
                    <td className="py-[1vw] text-right">$0.00</td>
                    <td className="py-[1vw] text-right">$0.00</td>
                    <td className="py-[1vw] text-right font-display font-bold">$2,400.00</td>
                  </tr>
                </tbody>
              </table>

              <div className="flex items-center justify-between bg-muted/40 rounded-[0.5vw] p-[1.5vw]">
                <div className="text-[0.9vw] text-muted-foreground">
                  Excluded non-rent charges (late fees, utilities…): <br/>
                  {phase >= 2 ? (
                    <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="font-bold text-destructive text-[1vw]">$195.00</motion.span>
                  ) : (
                    <span className="opacity-0 font-bold">$195.00</span>
                  )}
                  <span className="text-[0.8vw] ml-[1vw]">($120.00 late fee, $75.00 utilities)</span>
                </div>
                <div className="text-right">
                  <div className="text-[0.7vw] uppercase tracking-wider text-muted-foreground font-bold">Total Demand</div>
                  <div className="font-display text-[2vw] font-bold">$4,800.00</div>
                </div>
              </div>

              {phase >= 3 && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="border border-accent/40 bg-accent/5 rounded-[0.5vw] p-[1.5vw] space-y-[0.5vw]">
                  <div className="flex items-center gap-[0.5vw] font-medium text-accent-foreground text-[1vw]">
                    <Scale className="w-[1.2vw] h-[1.2vw] text-accent" />
                    California compliance snapshot
                  </div>
                  <div className="text-[0.9vw] text-muted-foreground">
                    Nonpayment notice period: <span className="font-bold text-foreground">3 Days</span> — Excludes weekends and court holidays.
                  </div>
                  <div className="text-[0.9vw] font-mono text-accent-foreground mt-[0.5vw]">
                    Computed Deadline: <span className="font-bold">Mon, Nov 6 at 5:00 PM</span>
                  </div>
                </motion.div>
              )}

              <div className="flex justify-end pt-[1vw]">
                <div className="bg-primary text-primary-foreground px-[1.5vw] py-[0.7vw] rounded-[0.5vw] text-[1vw] font-medium flex items-center gap-[0.5vw] shadow-sm">
                  Next <ArrowRight className="w-[1vw] h-[1vw]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </AppShell>
      <Cursor x={getCursorPos().x} y={getCursorPos().y} clicking={phase === 5} />
      <Kicker text="Rent-only balance isolated — late fees visibly excluded" />
    </motion.div>
  );
}