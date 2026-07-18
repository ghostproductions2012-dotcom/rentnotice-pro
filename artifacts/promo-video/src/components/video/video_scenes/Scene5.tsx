import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AppShell, Cursor, Kicker } from './SharedUI';
import { Briefcase, ArrowRight, UserCheck, Shield } from 'lucide-react';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500), // Handoff
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 bg-[#0F1729]"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-[5vw] overflow-hidden rounded-[1vw] shadow-2xl border border-white/10">
        <AppShell activePath="/">
          <div className="p-[3vw] h-full relative z-20 flex flex-col justify-center">
            <div className="text-center mb-[3vw]">
              <div className="w-[4vw] h-[4vw] bg-primary/10 text-primary rounded-[1vw] flex items-center justify-center mx-auto mb-[1vw]">
                <Briefcase className="w-[2vw] h-[2vw]" />
              </div>
              <h1 className="text-[3vw] font-display font-bold text-foreground">Attorney Portal</h1>
              <p className="text-[1.2vw] text-muted-foreground mt-[0.5vw]">When notice expires, hand off the case instantly.</p>
            </div>

            <div className="flex items-center justify-center gap-[2vw]">
              <motion.div 
                className="bg-card border border-border p-[2vw] rounded-[1vw] w-[20vw] text-center shadow-lg"
                initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
              >
                <div className="font-bold text-[1.2vw] mb-[0.5vw]">RentNotice Pro</div>
                <div className="text-[0.9vw] text-muted-foreground">Complete Packet & Ledger</div>
              </motion.div>

              <motion.div 
                className="text-primary"
                initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1 }}
              >
                <ArrowRight className="w-[3vw] h-[3vw]" />
              </motion.div>

              <motion.div 
                className="bg-card border border-primary p-[2vw] rounded-[1vw] w-[20vw] text-center shadow-[0_0_20px_rgba(237,187,82,0.2)]"
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.5 }}
              >
                <Shield className="w-[2vw] h-[2vw] text-primary mx-auto mb-[1vw]" />
                <div className="font-bold text-[1.2vw] mb-[0.5vw]">Partner Attorney</div>
                <div className="text-[0.9vw] text-primary font-medium">Ready for Eviction Filing</div>
              </motion.div>
            </div>
          </div>
        </AppShell>
      </div>
      <Kicker text="New! One-click attorney case handoff portal" />
    </motion.div>
  );
}
