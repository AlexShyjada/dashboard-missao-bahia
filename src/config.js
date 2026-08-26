/**
 * Configuração compartilhada pelos dois adaptadores.
 * Tudo aqui é público. O único segredo é o NOTION_TOKEN, que vem do ambiente.
 */
export function readConfig(env) {
  const get = (name, fallback) => {
    const value = env?.[name];
    return value === undefined || value === null || value === "" ? fallback : value;
  };

  return {
    token: get("NOTION_TOKEN", ""),

    // ID da base "Base de candidatos" (o trecho da URL entre a barra e o "?v=").
    databaseId: get("NOTION_DATABASE_ID", "3c14f290d5c480d7b649ee415cf17433"),

    title: get("DASHBOARD_TITLE", "Missão Bahia"),
    subtitle: get("DASHBOARD_SUBTITLE", "Base de candidatos"),

    // Valores tratados como concluído e como fora da conta.
    // A comparação ignora acentos, maiúsculas e pontuação.
    // "Feito" só vale como concluído em coluna que não tem assinatura.
    doneValues: get("DONE_VALUES", "feito,concluido,concluida,pago,ok,sim,pronto,enviado,emitido,finalizado"),

    // Numa coluna de documento, a assinatura é o fim da linha e "Feito" vira
    // etapa intermediária (documento pronto, ainda sem assinar).
    signedValues: get("SIGNED_VALUES", "assinado,assinada,assinados,assinadas"),
    naValues: get("NA_VALUES", "nao precisa,nao se aplica,n/a,na,nao aplicavel,dispensado"),

    // Segundos que o CDN pode servir a mesma resposta sem chamar a função.
    edgeTtl: Number(get("EDGE_TTL_SECONDS", 20)),
  };
}
