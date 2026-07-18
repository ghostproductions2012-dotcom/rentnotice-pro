import { motion } from 'framer-motion';
import { Scale, LayoutDashboard, FileText, Database, Calendar, MapPin, Wrench, MessageSquare, Building, Users, BookOpen, BarChart, History, Settings } from 'lucide-react';
import React from 'react';

export function Cursor({ x, y, clicking = false }: { x: any, y: any, clicking?: boolean }) {
  return (
    <motion.div
      className="absolute top-0 left-0 z-50 pointer-events-none"
      animate={{ x, y, scale: clicking ? 0.8 : 1 }}
      transition={{ 
        x: { type: 'spring', stiffness: 120, damping: 20 }, 
        y: { type: 'spring', stiffness: 120, damping: 20 }, 
        scale: { duration: 0.1 } 
      }}
    >
      <svg width="24" height="36" viewBox="0 0 24 36" fill="none" stroke="white" strokeWidth="2" xmlns="http://www.w3.org/2000/svg">
        <path d="M1 1l9 26 3-9 9-3L1 1z" fill="black" />
      </svg>
      {clicking && (
        <motion.div
          className="absolute top-[5px] left-[5px] w-6 h-6 -ml-3 -mt-3 rounded-full bg-accent/40"
          initial={{ opacity: 1, scale: 0.5 }}
          animate={{ opacity: 0, scale: 2.5 }}
          transition={{ duration: 0.4 }}
        />
      )}
    </motion.div>
  );
}

export function AppShell({ activePath = '/', children }: { activePath?: string, children: React.ReactNode }) {
  const groups = [
    {
      title: "Operations",
      items: [
        { icon: LayoutDashboard, label: "Dashboard", href: "/" },
        { icon: FileText, label: "Notices", href: "/notices" },
        { icon: Database, label: "Ledger Import", href: "/import" },
        { icon: Calendar, label: "Calendar", href: "/calendar" },
        { icon: MapPin, label: "Field Service", href: "/field" },
        { icon: Wrench, label: "Maintenance", href: "/maintenance" },
        { icon: MessageSquare, label: "Communications", href: "/comms" },
      ]
    },
    {
      title: "Records",
      items: [
        { icon: Building, label: "Properties", href: "/properties" },
        { icon: Users, label: "Tenants", href: "/tenants" },
        { icon: Scale, label: "Templates", href: "/templates" },
        { icon: BookOpen, label: "State Rules", href: "/rules" },
      ]
    },
    {
      title: "Administration",
      items: [
        { icon: BarChart, label: "Reports", href: "/reports" },
        { icon: History, label: "Audit Log", href: "/audit" },
        { icon: Settings, label: "Settings", href: "/settings" },
      ]
    }
  ];

  return (
    <div className="w-[100vw] h-[100vh] flex bg-background text-foreground overflow-hidden">
      <div className="w-[16vw] border-r border-border bg-card flex flex-col shrink-0 relative z-10 shadow-xl">
        <div className="p-[1.5vw] flex items-center gap-[0.75vw] border-b border-border">
          <div className="w-[2vw] h-[2vw] bg-primary rounded-[0.5vw] flex items-center justify-center text-primary-foreground">
            <Scale className="w-[1.2vw] h-[1.2vw]" />
          </div>
          <span className="font-display font-bold text-[1.2vw] tracking-tight text-foreground">RentNotice Pro</span>
        </div>
        
        <div className="flex-1 py-[1.5vw] px-[1vw] space-y-[1.5vw]">
          {groups.map(g => (
            <div key={g.title} className="space-y-[0.2vw]">
              <div className="px-[0.75vw] text-[0.7vw] font-semibold text-muted-foreground uppercase tracking-wider mb-[0.5vw]">
                {g.title}
              </div>
              {g.items.map(item => {
                const active = item.href === activePath;
                return (
                  <div key={item.label} className={`flex items-center gap-[0.75vw] px-[0.75vw] py-[0.5vw] rounded-[0.4vw] text-[0.9vw] font-medium transition-colors ${active ? 'bg-primary text-primary-foreground shadow-md' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}>
                    <item.icon className="w-[1vw] h-[1vw]" />
                    {item.label}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 relative bg-background overflow-hidden">
        {children}
      </div>
    </div>
  );
}

export function Kicker({ text }: { text: string }) {
  return (
    <motion.div 
      className="absolute bottom-[8vh] left-1/2 -translate-x-1/2 bg-card text-foreground px-[2.5vw] py-[1.5vh] rounded-full text-[1.5vw] font-medium shadow-2xl z-40 border border-border/50"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
    >
      {text}
    </motion.div>
  );
}
