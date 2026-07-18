import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AppShell, Cursor, Kicker } from './SharedUI';
import { Calculator, Scale, AlertTriangle, ShieldCheck } from 'lucide-react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500), // Exclude non-rent
      setTimeout(() => setPhase(3), 2500), // Show CA warning
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 bg-[#0F1729]"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-[5vw] overflow-hidden rounded-[1vw] shadow-2xl border border-white/10">
        <AppShell activePath="/notices">
          <div className="p-[3vw] pr-[13vw] h-full relative z-20">
            <div className="flex items-center justify-between mb-[2vw]">
              <h1 className="text-[2.5vw] font-display font-bold text-foreground">Calculation Engine</h1>
              <div className="bg-primary/20 text-primary px-[1vw] py-[0.5vw] rounded-[0.5vw] font-bold text-[1vw] flex items-center gap-[0.5vw]">
                <Scale className="w-[1vw] h-[1vw]" /> 50 States + DC
              </div>
            </div>
            
            <div className="flex gap-[2vw]">
              <div className="flex-1 space-y-[1vw]">
                <div className="bg-card border border-border rounded-[1vw] p-[1.5vw] shadow-sm">
                  <div className="flex justify-between items-center mb-[1vw] border-b border-border pb-[1vw]">
                    <span className="font-bold text-[1.2vw]">October Rent</span>
                    <span className="text-[1.2vw]">$2,500.00</span>
                  </div>
                  <div className={`flex justify-between items-center mb-[1vw] border-b border-border pb-[1vw] transition-colors ${phase >= 2 ? 'opacity-30 line-through text-destructive' : ''}`}>
                    <span className="font-bold text-[1.2vw]">Late Fee</span>
                    <span className="text-[1.2vw]">$150.00</span>
                  </div>
                  <div className="flex justify-between items-center pt-[0.5vw] text-primary">
                    <span className="font-bold text-[1.5vw] uppercase">Total Demand</span>
                    <span className="text-[2vw] font-display font-bold">{phase >= 2 ? '$2,500.00' : '$2,650.00'}</span>
                  </div>
                </div>

                {phase >= 2 && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-[0.9vw] text-destructive flex items-center gap-[0.5vw] font-medium">
                    <ShieldCheck className="w-[1vw] h-[1vw]" /> Non-rent charges auto-excluded for compliance
                  </motion.div>
                )}
              </div>

              {phase >= 3 && (
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="w-[20vw] bg-accent/10 border border-accent/30 p-[1.5vw] rounded-[1vw]">
                  <AlertTriangle className="w-[2vw] h-[2vw] text-accent mb-[1vw]" />
                  <h3 className="font-bold text-[1.2vw] text-accent mb-[0.5vw]">California Specific</h3>
                  <p className="text-[0.9vw] text-foreground/80 mb-[1vw]">Calculation excludes state holidays and weekends automatically.</p>
                  <div className="font-mono text-[0.8vw] bg-background/50 p-[0.5vw] rounded">
                    Exp: Nov 6 at 5:00 PM
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </AppShell>
      </div>
      <Kicker text="State-aware calculation & rent isolation" />
    </motion.div>
  );
}
