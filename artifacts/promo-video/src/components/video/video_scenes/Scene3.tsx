import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AppShell, Cursor, Kicker } from './SharedUI';
import { FileText, Lock, Download } from 'lucide-react';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 600), // Finalize
      setTimeout(() => setPhase(3), 1000), // PDF docs show
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
          <div className="p-[3vw] pr-[13vw] h-full relative z-20 flex flex-col">
            <div className="flex justify-between items-center mb-[2vw]">
              <h1 className="text-[2.5vw] font-display font-bold text-foreground">Court-Ready Packets</h1>
              <motion.div 
                className={`px-[1.5vw] py-[0.7vw] rounded-[0.5vw] text-[1vw] font-bold flex items-center gap-[0.5vw] shadow-sm transition-all ${phase >= 2 ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground'}`}
              >
                <Lock className="w-[1vw] h-[1vw]" /> {phase >= 2 ? 'Finalized' : 'Finalize Notice'}
              </motion.div>
            </div>

            {phase >= 3 && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} 
                className="flex-1 flex gap-[2vw] justify-center items-center"
              >
                {[
                  { name: "3-Day Notice", type: "PDF" },
                  { name: "Proof of Service", type: "PDF" },
                  { name: "Audit Summary", type: "PDF" }
                ].map((doc, i) => (
                  <motion.div 
                    key={doc.name}
                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ delay: i * 0.15 }}
                    className="w-[12vw] aspect-[1/1.4] bg-white rounded-[0.5vw] shadow-2xl p-[1vw] relative flex flex-col"
                  >
                    <div className="flex-1 border-2 border-dashed border-gray-200 rounded-[0.2vw] flex flex-col items-center justify-center opacity-50">
                      <FileText className="w-[3vw] h-[3vw] text-gray-400 mb-[0.5vw]" />
                    </div>
                    <div className="absolute bottom-[1vw] left-0 w-full text-center text-[0.8vw] font-bold text-black uppercase tracking-wider">
                      {doc.name}
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            )}
            
            {phase >= 3 && (
              <motion.div 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}
                className="absolute bottom-[3vw] right-[3vw] bg-primary/20 text-primary px-[1vw] py-[0.5vw] rounded-[0.5vw] text-[1vw] font-bold flex items-center gap-[0.5vw]"
              >
                <Download className="w-[1vw] h-[1vw]" /> Download Complete Packet
              </motion.div>
            )}
          </div>
        </AppShell>
      </div>
      <Kicker text="Generate locked, court-defensible PDF packets" />
    </motion.div>
  );
}
