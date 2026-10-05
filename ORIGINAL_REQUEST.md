# Original User Request

## 2026-10-02T01:27:44Z

Telegram English Tracker Bot: Sistema integral de constancia y aprendizaje diario de inglés en Telegram impulsado por Google Gemini AI, Vercel Serverless y Redis KV. El objetivo es resolver de raíz los fallos de formato en Telegram, completar los 4 puntos estructurales pendientes respetando las restricciones de Vercel Free Tier (1 solo cron diario), implementar 5 mejoras de alto impacto para la consistencia y sumar un sistema inteligente de perfilado de nivel y progreso del estudiante optimizado para bajo consumo de tokens y memoria.

Working directory: c:\Users\juanp\Documents\GitHub\telegram-english-bot
Integrity mode: development

---

## Requirements

### R1. Formato HTML de Telegram Robusto y Balanceado
- Corregir el analizador y formateador de mensajes para Telegram en api/_telegram.js y api/_queue.js.
- Escapar de forma estricta todos los caracteres reservados fuera de etiquetas (& -> &amp;, < -> &lt;, > -> &gt;).
- Implementar un balanceador de etiquetas con pila (stack-based tag balancer) que cierre automáticamente cualquier etiqueta (<b>, <i>, <code>, <blockquote>) huérfana o cortada.
- Prevenir colisiones entre sintaxis Markdown (viñetas con *) y etiquetas de cursiva/negrita.
- Asegurar que nunca se supere el límite de 4096 caracteres de Telegram sin un particionado o truncamiento seguro de etiquetas.
- Eliminar la degradación destructiva a texto plano sin formato en caso de error 400.

### R2. Culminación de los 4 Puntos Estructurales (100% del Core)
- Catchup Multi-día en Cron (api/cron.js): Algoritmo retrospectivo que recorra día a día desde lastEvaluatedDate + 1 hasta ayer si el bot estuvo inactivo varios días, descontando escudos secuencialmente y aplicando penalizaciones exactas sin saltos.
- Sincronización Horaria Dual con 1 Solo Cron Diario (Vercel Free Tier): Programar el cron diario a las 06:00 UTC en vercel.json (que corresponde a las 03:00 AM en Argentina UTC-3 y las 00:00 AM en México UTC-6). A esa hora la jornada anterior ya concluyó formalmente para ambos países, permitiendo evaluar a ambos participantes en una única ejecución diaria sin exceder el límite gratuito de Vercel.
- Escalabilidad Dinámica de Participantes: Refactorizar state.users para soportar múltiples participantes sin perder los datos de producción de userA (Bro Juan, racha 47) y userB (Sister Francy, racha 18).
- Dashboard Web Público y Endpoint Seguro (public/index.html y api/status.js): Endpoint GET /api/status de solo lectura que exponga de forma segura las rachas, escudos y estado diario sin credenciales, y un frontend responsivo y estético en public/index.html con tema oscuro y métricas en vivo.

### R3. Cinco Mejoras Clave de Experiencia y Pedagogía
- M1: Práctica Oral con Notas de Voz (Speaking): Soporte para mensajes de voz (voice) en api/webhook.js. Descarga del .ogg de Telegram y envío directo en Base64 a Gemini Multimodal para transcribir, evaluar pronunciación/fluidez y validar como /done.
- M2: Daily Spark / Disparador Temático: Pregunta disparadora automática diaria (ej. reto de opinión o anécdota) para que los usuarios no enfrenten la "hoja en blanco" al practicar.
- M3: Alerta Preventiva de Racha: Notificación nocturna de advertencia a los usuarios que aún no hayan practicado ni usado escudo, activada dentro del ciclo operativo.
- M4: Banco de Vocabulario y Repetición Espaciada (/review): Extracción de 1 modismo/collocation clave por práctica, almacenada de forma compacta en Redis, con comando /review para afianzar retención.
- M5: Botones Interactivos (Inline Keyboards): Botones táctiles ([🔥 Ver Estado], [🛡️ Usar Escudo], [💡 Reto de Hoy], [📚 Repasar Vocabulario]) en las respuestas de Telegram para interactuar con 1 toque.

### R4. Seguimiento Inteligente de Nivel y Progreso (Optimizado Free Tier)
- Implementar un perfil de aprendizaje por usuario en Redis (user.profile) extremadamente compacto:
  - Nivel CEFR estimado actual (ej. A2, B1, B2).
  - Lista de fortalezas demostradas (máximo 3 frases clave).
  - Lista de áreas a reforzar prioritarias (máximo 3 errores o patrones recurrentes).
  - Fecha de última actualización.
- Cero consumo extra de tokens: Extraer estos indicadores directamente del mismo prompt de validación de /done en callGemini agregando campos opcionales al schema JSON, sin realizar llamadas HTTP adicionales a Gemini.
- Espacio mínimo en Redis: Limitar el almacenamiento a menos de 500 bytes por usuario mediante estructuras ligeras.

---

## Acceptance Criteria

### Formato y Telegram
- [ ] Frases con caracteres &, <, >, comillas y viñetas Markdown se renderizan en Telegram con formato HTML enriquecido (<b>, <blockquote>, <code>) sin producir error 400.
- [ ] Mensajes con etiquetas abiertas son autocerrados antes del envío sin perder estilo ni degradarse a texto plano.
- [ ] Textos largos (>4000 caracteres) se envían de forma segura sin violar el límite de Telegram.

### Cron y Consistencia Temporal
- [ ] El cron en vercel.json tiene una única ejecución diaria fijada a las 06:00 UTC.
- [ ] La evaluación retrospectiva procesa correctamente saltos de 2 o más días sin omitir deducción de escudos ni penalizaciones.
- [ ] El reset semanal de escudos a 2 ocurre fielmente cada lunes en la fecha local de cada estudiante.

### Escalabilidad y Persistencia
- [ ] Los datos existentes en Redis (userA con racha 47 y userB con racha 18) se mantienen 100% íntegros tras la migración.
- [ ] El sistema permite agregar nuevos participantes sin modificar el esquema central ni romper /status.

### Dashboard Web
- [ ] GET /api/status responde en JSON con código 200 y datos públicos agregados (sin tokens ni chat IDs).
- [ ] public/index.html renderiza visualmente las tarjetas de los alumnos, sus rachas y el estado del día consumiendo /api/status.

### Experiencia y Aprendizaje
- [ ] Enviar una nota de voz en Telegram genera transcripción y feedback pedagógico con validación de racha.
- [ ] El comando /review muestra términos clave del banco de vocabulario del usuario.
- [ ] Las respuestas del bot incluyen botones inline funcionales para agilizar acciones comunes.
- [ ] El perfil del usuario en Redis refleja su nivel CEFR y fortalezas sin llamadas adicionales de API.

### Suite de Pruebas
- [ ] npm test ejecuta y aprueba el 100% de las pruebas offline ampliadas (formato, catchup multi-día, perfilado y nuevo endpoint).
