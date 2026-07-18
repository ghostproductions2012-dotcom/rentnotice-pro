import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { AppShell, Cursor, Kicker } from './SharedUI';
import { CheckCircle, AlertTriangle, Lock, Download, FileText } from 'lucide-react';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2000), // Cursor move to finalize
      setTimeout(() => setPhase(3), 3500), // Click Finalize
      setTimeout(() => setPhase(4), 5000), // Lock state & Packet appears
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const getCursorPos = () => {
    if (phase < 2) return { x: '50vw', y: '60vh' };
    if (phase >= 2 && phase < 4) return { x: '68vw', y: '25vh' }; // Over Finalize button
    return { x: '45vw', y: '50vh' }; // Move to packet
  };

  return (
    <motion.div className="absolute inset-0 bg-background" exit={{ opacity: 0 }}>
      <AppShell activePath="/notices">
        <div className="p-[3vw] max-w-[65vw] mx-auto space-y-[2vw]">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-[2.5vw] font-display font-bold tracking-tight flex items-center gap-[1vw]">
                Notice Workroom
                {phase >= 4 && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="bg-muted text-muted-foreground px-[0.5vw] py-[0.2vw] text-[0.8vw] rounded font-mono uppercase">
                    FINALIZED
                  </motion.span>
                )}
              </h1>
              <p className="text-[1vw] text-muted-foreground">Maria Alvarez • Maple Court, #4B</p>
            </div>
            {phase < 4 && (
              <div className="bg-primary text-primary-foreground px-[1.5vw] py-[0.7vw] rounded-[0.5vw] text-[1vw] font-medium flex items-center gap-[0.5vw] shadow-sm">
                <Lock className="w-[1vw] h-[1vw]" /> Finalize & Lock
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-[2vw]">
            <div className="col-span-2 space-y-[2vw]">
              <div className="border border-primary/20 rounded-[0.5vw] bg-primary/5 p-[1.5vw]">
                <div className="flex items-center gap-[0.5vw] font-medium border-b border-primary/10 pb-[1vw] mb-[1vw] text-[1.1vw]">
                  <CheckCircle className="w-[1.2vw] h-[1.2vw] text-primary" /> Compliance Validation
                </div>
                <div className="text-[0.9vw] text-foreground">
                  All compliance checks passed.
                  <ul className="mt-[0.5vw] space-y-[0.3vw] text-muted-foreground list-disc pl-[1.5vw]">
                    <li>CCP §1161(2) requirements met</li>
                    <li>No local moratorium blocks</li>
                    <li>Rent control caps verified</li>
                  </ul>
                </div>
              </div>

              {phase >= 4 && (
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="border border-border rounded-[0.5vw] bg-card p-[1.5vw]">
                  <div className="flex items-center justify-between border-b pb-[1vw] mb-[1vw]">
                    <div className="font-bold text-[1.1vw] flex items-center gap-[0.5vw]">
                      <FileText className="w-[1.2vw] h-[1.2vw]" /> Final Document Packet
                    </div>
                    <div className="text-primary text-[0.9vw] flex items-center gap-[0.5vw] font-medium">
                      <Download className="w-[1vw] h-[1vw]" /> Download PDF
                    </div>
                  </div>
                  <div className="flex gap-[1vw]">
                    {/* PDF visual representation */}
                    <div className="w-[8vw] h-[11vw] bg-white border shadow-sm rounded p-[0.5vw] relative flex flex-col items-center pt-[1vw]">
                      <div className="w-[4vw] h-[0.5vw] bg-gray-300 mb-[1vw]" />
                      <div className="w-[6vw] h-[0.3vw] bg-gray-200 mb-[0.3vw]" />
                      <div className="w-[5vw] h-[0.3vw] bg-gray-200 mb-[2vw]" />
                      <div className="w-[6vw] h-[0.5vw] bg-primary/30" />
                      <div className="absolute bottom-[0.5vw] text-[0.5vw] font-bold text-primary">Notice</div>
                    </div>
                    <div className="w-[8vw] h-[11vw] bg-white border shadow-sm rounded p-[0.5vw] relative flex flex-col items-center pt-[1vw]">
                      <div className="w-[4vw] h-[0.5vw] bg-gray-300 mb-[1vw]" />
                      <div className="absolute bottom-[0.5vw] text-[0.5vw] font-bold text-primary">Proof of Service</div>
                    </div>
                    <div className="w-[8vw] h-[11vw] bg-white border shadow-sm rounded p-[0.5vw] relative flex flex-col items-center pt-[1vw]">
                      <div className="w-[4vw] h-[0.5vw] bg-gray-300 mb-[1vw]" />
                      <div className="absolute bottom-[0.5vw] text-[0.5vw] font-bold text-primary">Audit Summary</div>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>

            <div className="space-y-[2vw]">
              <div className="border border-border rounded-[0.5vw] bg-card p-[1.5vw] text-[0.9vw]">
                <div className="font-bold border-b pb-[1vw] mb-[1vw]">Notice Details</div>
                <div className="space-y-[0.8vw]">
                  <div className="flex justify-between"><span className="text-muted-foreground">Type</span> <span className="font-medium">3-Day Pay or Quit</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">State</span> <span className="font-medium">California</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Demanded</span> <span className="font-display font-bold">$4,800.00</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </AppShell>
      <Cursor x={getCursorPos().x} y={getCursorPos().y} clicking={phase === 3} />
      <Kicker text="Compliance validated & court-ready PDF assembled" />
    </motion.div>
  );
}