const profile = process.env.SI_LOAD_PROFILE || 'nf08';
if (profile === 'nf08') await import('./nf08.mjs');
else if (profile === 'capacity') await import('./capacity.mjs');
else throw new Error('SI_LOAD_PROFILE must be nf08 or capacity');
