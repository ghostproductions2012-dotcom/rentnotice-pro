import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AppShell, Cursor, Kicker } from './SharedUI';
import { Database, Upload, CheckCircle2, Search, Link as LinkIcon, RefreshCcw } from 'lucide-react';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500), // Buildium sync
      setTimeout(() => setPhase(3), 2500), // Data appears
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 bg-[#0F1729]"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-[5vw] overflow-hidden rounded-[1vw] shadow-2xl border border-white/10">
        <AppShell activePath="/import">
          <div className="p-[3vw] pr-[13vw] h-full relative z-20">
            <h1 className="text-[2.5vw] font-display font-bold text-foreground mb-[2vw]">One-Click Import</h1>
            
            <div className="flex gap-[2vw]">
              <motion.div 
                className="flex-1 bg-card border border-border rounded-[1vw] p-[2vw] relative overflow-hidden"
              >
                <div className="flex items-center gap-[1vw] mb-[1.5vw]">
                  <Database className="w-[2vw] h-[2vw] text-primary" />
                  <h2 className="text-[1.5vw] font-bold">Buildium Integration</h2>
                </div>
                
                <div className={`p-[1vw] rounded-[0.5vw] flex items-center justify-center gap-[0.5vw] font-bold text-[1vw] transition-colors ${phase >= 2 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                  {phase >= 2 ? <><CheckCircle2 className="w-[1vw] h-[1vw]" /> Synced Successfully</> : <><RefreshCcw className="w-[1vw] h-[1vw] animate-spin" /> Syncing Ledgers...</>}
                </div>

                <div className="mt-[2vw] space-y-[0.5vw]">
                  {[1,2,3].map(i => (
                    <motion.div 
                      key={i}
                      className="h-[2vw] bg-muted/50 rounded flex items-center px-[1vw]"
                      initial={{ opacity: 0, x: -10 }}
                      animate={phase >= 3 ? { opacity: 1, x: 0 } : {}}
                      transition={{ delay: i * 0.1 }}
                    >
                      <div className="h-[0.5vw] w-[10vw] bg-foreground/20 rounded mr-auto" />
                      <div className="h-[0.5vw] w-[3vw] bg-primary/40 rounded" />
                    </motion.div>
                  ))}
                </div>
              </motion.div>

              <div className="flex-1 bg-card border border-border rounded-[1vw] p-[2vw] opacity-50 flex flex-col items-center justify-center text-center border-dashed">
                <Upload className="w-[3vw] h-[3vw] text-muted-foreground mb-[1vw]" />
                <div className="text-[1.2vw] font-bold">CSV / PDF Upload</div>
                <div className="text-[0.9vw] text-muted-foreground">Universal support for other systems</div>
              </div>
            </div>
          </div>
        </AppShell>
      </div>
      <Kicker text="Buildium Integration & Universal Ledger Import" />
    </motion.div>
  );
}
