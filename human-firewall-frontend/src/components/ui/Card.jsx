import React from 'react';

export function Card({ children, className = '' }) {
  return (
    <div className={`glass-card rounded-2xl p-8 hover:scale-[1.02] transition-transform duration-300 ${className}`}>
      {children}
    </div>
  );
}
