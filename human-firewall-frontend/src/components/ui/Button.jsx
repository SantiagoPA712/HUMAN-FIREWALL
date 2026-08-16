import React from 'react';

export function Button({ children, variant = 'primary', className = '', ...props }) {
  const baseStyles = "px-6 py-3 rounded-lg font-semibold transition-all duration-300 flex items-center justify-center gap-2";
  
  const variants = {
    primary: "bg-brand-blue text-white hover:bg-brand-light shadow-lg hover:shadow-brand-blue/30",
    secondary: "bg-white text-brand-blue hover:bg-gray-100",
    outline: "border-2 border-brand-blue text-brand-blue hover:bg-brand-blue/10"
  };

  return (
    <button className={`${baseStyles} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
