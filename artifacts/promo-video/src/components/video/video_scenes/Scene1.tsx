import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { AppShell, Cursor, Kicker } from './SharedUI';
import { Database, Upload, CheckCircle2, UserRound, Sparkles, FileText } from 'lucide-react';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2500), // Cursor moves to dropzone
      setTimeout(() => setPhase(3), 4000), // Drop event
      setTimeout(() => setPhase(4), 5000), // Parsed
      setTimeout(() => setPhase(5), 8000), // Matched tenant
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const getCursorPos = () => {
    if (phase < 2) return { x: '50vw', y: '80vh' };
    if (phase === 2) return { x: '45vw', y: '40vh' };
    if (phase === 3) return { x: '45vw', y: '40vh' };
    return { x: '70vw', y: '60vh' };
  };

  return (
    <motion.div className="absolute inset-0 bg-background" exit={{ opacity: 0 }}>
      <AppShell activePath="/import">
        <div className="p-[3vw] max-w-[60vw] mx-auto space-y-[2vw]">
          <div className="text-center space-y-[0.5vw]">
            <div className="w-[4vw] h-[4vw] bg-primary/10 text-primary rounded-[1vw] flex items-center justify-center mx-auto mb-[1vw]">
              <Database className="w-[2vw] h-[2vw]" />
            </div>
            <h1 className="text-[2vw] font-display font-bold tracking-tight">Import Ledger</h1>
            <p className="text-[1vw] text-muted-foreground">Upload a tenant statement or exported ledger.</p>
          </div>

          <div className="space-y-[1.5vw]">
            {phase < 4 && (
              <motion.div 
                className={`border-dashed border-[0.2vw] rounded-[1vw] p-[3vw] text-center ${phase === 2 ? 'border-primary bg-primary/5' : 'border-border'}`}
                layout
              >
                <Upload className="w-[3vw] h-[3vw] mx-auto text-muted-foreground mb-[1vw]" />
                <h3 className="text-[1.2vw] font-medium">Drag & drop ledger file</h3>
                {phase >= 2 && phase < 3 && (
                  <motion.div 
                    className="absolute z-30 pointer-events-none"
                    initial={{ opacity: 0, x: '30vw', y: '20vh' }}
                    animate={{ opacity: 1, x: '45vw', y: '40vh' }}
                  >
                    <div className="bg-white text-black p-[0.5vw] text-[0.8vw] shadow-lg rounded border">AppFolio_Statement.pdf</div>
                  </motion.div>
                )}
              </motion.div>
            )}

            {phase >= 4 && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-[1.5vw]">
                <div className="bg-primary/5 border border-primary/20 rounded-[0.5vw] p-[1vw] flex gap-[1vw]">
                  <Sparkles className="w-[1.5vw] h-[1.5vw] text-primary shrink-0" />
                  <div>
                    <div className="text-[1vw] font-medium">AppFolio detected</div>
                    <div className="text-[0.8vw] text-muted-foreground">Statement header read automatically.</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-[1.5vw]">
                  <div className="border border-border rounded-[0.5vw] bg-card p-[1.5vw]">
                    <div className="flex items-center gap-[0.5vw] mb-[1vw] font-medium border-b pb-[1vw]">
                      <FileText className="w-[1vw] h-[1vw]" /> Statement Details
                    </div>
                    <div className="space-y-[0.5vw] text-[0.9vw]">
                      <div className="flex justify-between"><span className="text-muted-foreground">Tenant</span> <span className="font-medium">Maria Alvarez</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Premises</span> <span className="font-medium">Maple Court, #4B</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Transactions</span> <span className="font-medium">12 rows</span></div>
                    </div>
                  </div>

                  {phase >= 5 && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="border border-border rounded-[0.5vw] bg-card p-[1.5vw]">
                      <div className="flex items-center gap-[0.5vw] mb-[1vw] font-medium border-b pb-[1vw]">
                        <UserRound className="w-[1vw] h-[1vw]" /> Tenant Matching
                      </div>
                      <div className="bg-primary/5 border border-primary/20 rounded-[0.5vw] p-[1vw] flex items-start gap-[0.5vw]">
                        <CheckCircle2 className="w-[1vw] h-[1vw] text-primary shrink-0 mt-[0.2vw]" />
                        <div className="text-[0.9vw]">
                          Matched existing tenant <span className="font-bold">Maria Alvarez</span> — Unit 4B.
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </AppShell>
      <Cursor x={getCursorPos().x} y={getCursorPos().y} clicking={phase === 3} />
      <Kicker text="Ledger import — format & tenant detected instantly" />
    </motion.div>
  );
}