import React from 'react';

export function Input({ label, type = "text", icon: Icon, className = "", ...props }) {
  return (
    <div className="flex flex-col gap-2 w-full">
      {label && <label className="text-sm font-semibold text-text-secondary">{label}</label>}
      <div className="relative flex items-center w-full">
        {Icon && <Icon className="absolute left-3 text-gray-500 w-5 h-5 pointer-events-none" />}
        <input 
          type={type}
          className={`w-full bg-bg-deep/50 border border-gray-700 rounded-lg py-3 text-white focus:outline-none focus:border-brand-blue focus:ring-1 focus:ring-brand-blue transition-all ${Icon ? 'pl-10 pr-3' : 'px-4'} ${className}`}
          {...props}
        />
      </div>
    </div>
  );
}
