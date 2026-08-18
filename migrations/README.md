# Migraciones

Cada cambio en la base de datos va en un archivo **nuevo y numerado**. Nadie edita
`schema.sql` ni `init_db.js` directamente.

## Por que

Las cuatro historias de usuario del sprint tocan tablas de gamificacion. Si dos personas
editan `schema.sql` a la vez, Git genera un conflicto en cada push. Con un archivo por
migracion, Git no tiene nada que resolver: son archivos distintos.

## Convencion de nombres

```
NNN_descripcion_corta.sql
```

Ejemplo: `001_points_ledger.sql`

## Rangos reservados

Para que los numeros no choquen, cada integrante tiene su propio rango:

| Integrante | Rango     | Historias                          |
|------------|-----------|------------------------------------|
| Santi      | 001 - 019 | Puntos automaticos + Recompensas   |
| Companero  | 020 - 039 | (sus dos historias)                |
| Comunes    | 090 - 099 | Cambios acordados entre los dos    |

## Reglas

1. Una migracion ya mergeada a `main` **no se edita jamas**. Si algo salio mal, se
   corrige con una migracion nueva.
2. Toda migracion debe poder ejecutarse sobre una base que ya la tiene aplicada sin
   romper: usar `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING`.
3. Si tu migracion depende de una tabla que crea otra migracion, decilo en un comentario
   al inicio del archivo.

## Como aplicarlas

Solas. `npm run dev` y `npm run start` ejecutan primero el runner, que aplica
en orden lo que falte. Tambien se puede correr suelto:

```bash
cd human-firewall-backend
npm run migrate
```

El estado se guarda en la tabla `schema_migrations`: cada archivo aplicado
queda registrado con su nombre, asi que correr el runner dos veces no repite
nada. Cada migracion va dentro de una transaccion; si falla a la mitad no queda
a medio aplicar ni se marca como hecha.

`schema.sql` se trata como la migracion `000`. Sobre una base que ya venia
funcionando de antes (por ejemplo la de Supabase, cargada a mano), el runner
detecta que las tablas ya existen y solo registra el estado, sin reejecutarla.

Por eso sigue siendo obligatoria la regla 2 de mas abajo: toda migracion tiene
que poder ejecutarse dos veces sin romper.
