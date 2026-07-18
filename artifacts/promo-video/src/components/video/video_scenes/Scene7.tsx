import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Scale } from 'lucide-react';

export function Scene7() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 bg-[#0F1729] flex flex-col items-center justify-center text-center"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      {/* Background gradients */}
      <motion.div className="absolute w-[600px] h-[600px] rounded-full opacity-20 blur-[100px]"
        style={{ background: 'radial-gradient(circle, hsl(38 90% 62%), transparent)' }}
        animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 4, repeat: Infinity }} />

      <motion.div 
        initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring' }}
        className="w-[6vw] h-[6vw] bg-primary rounded-[1.5vw] flex items-center justify-center text-primary-foreground mb-[2vw] relative z-10"
      >
        <Scale className="w-[3vw] h-[3vw]" />
      </motion.div>
      
      <motion.h1 
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }}
        className="text-[5vw] font-display font-bold text-foreground leading-tight tracking-tight relative z-10"
      >
        RentNotice Pro
      </motion.h1>

      <motion.p 
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.6 }}
        className="text-[1.5vw] text-muted-foreground mt-[1vw] relative z-10"
      >
        Eviction Notice Software for All 50 States
      </motion.p>
      
      {phase >= 2 && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="mt-[3vw] bg-card border border-border px-[2vw] py-[1vw] rounded-[0.5vw] text-[1.2vw] font-bold shadow-xl relative z-10"
        >
          Try it with Sample Data instantly
        </motion.div>
      )}
    </motion.div>
  );
}
