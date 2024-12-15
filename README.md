- [1. Introducción](#1-introducción)
   * [1.1. ¿Cual es el objetivo de este proyecto?](#11-cual-es-el-objetivo-de-este-proyecto)
   * [1.2. ¿Cuales son las limitaciones?](#12-cuales-son-las-limitaciones)
- [2. Presupuesto](#2-presupuesto)
- [3. Documentación técnica](#3-documentación-técnica)
   * [3.1. Distribución de carga](#31-distribución-de-carga)
      + [3.1.1. “Least Connections” (LC)](#311-least-connections-lc)
      + [3.1.2. “Weighted Least-Connection” (WLC)](#312-weighted-least-connection-wlc)
      + [3.1.3. “Round Robin” (RR)](#313-round-robin-rr)
      + [3.1.4. “Weighted Round Robin” (WRR)](#314-weighted-round-robin-wrr)
   * [3.3. Alta disponibilidad](#33-alta-disponibilidad)
   * [3.4. Instalación de paquetes](#34-instalación-de-paquetes)
   * [3.5. Configuración de IPVS en master](#35-configuración-de-ipvs-en-master)
      + [3.5.1. Configuración de IPV4 forwarding](#351-configuración-de-ipv4-forwarding)
      + [3.5.2. Comprobación de funcionamiento de IPVS](#352-comprobación-de-funcionamiento-de-IPVS)
      + [3.5.3. Configuración de Load Balancing y Alta Disponibilidad](#353-configuración-de-load-balancing-y-alta-disponibilidad)
- [4. Setup de base de datos y servicio web](#4-setup-de-base-de-datos-y-servicio-web)
- [5. Mejoras](#5-mejoras)
  * [5.1. Despliegues automatizados y sincronización de nodos](#51-despliegues-automatizados-y-sincronización-de-nodos)
- [6. Fuentes](#6-fuentes)
   * [6.1. Linux Virtual Server](#61-linux-virtual-server)
   * [6.2. IPVS](#62-ipvs)
   * [6.3. Keepalived](#63-keepalived)
   * [6.4. Deno](#64-deno)
   * [6.5. SurrealDB](#65-surrealdb)

<a name="1-introducción"></a>
# 1. Introducción
<a name="11-cual-es-el-objetivo-de-este-proyecto"></a>
## 1.1. ¿Cual es el objetivo de este proyecto?
El objetivo de este proyecto será tener una infraestructura redundante, ofreciendo alta disponibilidad y balanceo de carga.

El servicio web es el que dispone de alta disponibilidad y balanceo de carga.
Si este servicio deja de responder en el servidor master o en cualquiera de los servidores nodo, seguirá habiendo disponibilidad; 

Este servicio estará disponible siempre y cuando el servicio de balanceo de carga y alta disponibilidad en el servidor master esté funcionando y el servicio web esté funcionando en por lo menos uno de los servidores, ya sea el master o alguno de los nodos.

En este caso se usará IPVS, que forma parte del Linux Virtual Server y permitirá de forma sencilla y ocupando muy poco espacio, balancear la carga y aumentar la disponibilidad de un sitio

El motivo es demostrar el funcionamiento de una herramienta de gran utilidad que además está escrita en C, siendo una utilidad que operará con mayor rendimiento que otras soluciones.

<a name="12-cuales-son-las-limitaciones"></a>
## 1.2. ¿Cuales son las limitaciones?
La infraestructura no dispondrá de alta disponibilidad en el sentido de ser un sistema en el que cualquier servidor se podría caer y todo seguiría operativo.

En este caso, la infraestructura necesita que el servidor master esté operativo y que IPVS esté activo y funcionando correctamente.
<a name="2-presupuesto"></a>
# 2. Presupuesto
Los cálculos de presupuesto en un despliegue en producción de la infraestructura presentada variarían dependiendo de la cantidad de nodos, cantidad de servicios por nodo y costo de los nodos, además de la localización de estos nodos y de si los nodos son servidores propios.

En este caso, el presupuesto inicial sería el más elevado porque haría falta realizar la compra de los servidores y, una vez adquiridos, el presupuesto se basaría en su consumo eléctrico y en el gasto por mantenimiento.

En este caso se asumirá que estamos no comprando servidores sino usando VPS, y que el proveedor incluye en el costo del servicio su mantenimiento.
Calculamos los presupuestos mensuales asumiendo que no se escalarán los recursos usados.

| Servicio | Carga del servicio | Recursos necesarios | N de servidores |
|----------|--------------------|---------------------|-----------------|
| Servidor web deno | 200 usuarios al día | 32GiB de RAM, 16 núcleos | 3 |
| Base de datos | Cuentas de +2000 usuarios | 500 GiB SSD NVME | 1 |
| Servicio LVM | Enrutamiento de tráfico entre nodos | Tarjeta de red de 1Gb/s | 1 |

Por tanto el servidor master será el más caro, al tener los 3 servicios. En este caso, los nodos tendrán únicamente el servidor web, que compartirán entre ellos y el servidor raíz.

Costo mensual: 

| Servidor master | Primer nodo | Segundo nodo | Costo total |
|-----------------|-------------|--------------|-------------|
| IVA no incl.    | 200 € / mes  | 60 € / mes   | 60 € / mes  | 320 € / mes |
| Impuesto (21% iva) | 42 € / mes | 12,6 € / mes | 12,6 € / mes | 67,2 € / mes |
| Costo total     | 242 € / mes  | 72,6 € / mes | 72,6 € / mes | 387,2 € / mes |

<a name="3-documentación-técnica"></a>
# 3. Documentación técnica
Configuraremos una infraestructura que servirá con alta disponibilidad y balanceo de carga un sitio web con deno, que interactuará con una base de datos SurrealDB.

IPVS es parte del proyecto LVS (Linux Virtual Server), y está implementado como un módulo del kernel de linux, por lo que su rendimiento se verá beneficiado por ello.

Este módulo será el que gestione el balanceo de carga, distribuyendo paquetes TCP acorde a una tabla que podrá ser configurada.

Para esta configuración inicialmente usaremos `ipvsadm` que, a través de comandos, permitirá interactuar con la tabla de conexiones de IPVS.

Esta tabla le indica a IPVS cuales son las direcciones IP de los nodos, contra qué puertos redirigir los paquetes TCP y el algoritmo de reparto de carga entre los nodos.

<a name="31-distribución-de-carga"></a>
## 3.1. Distribución de carga
Los pesos son valores atribuidos a los servidores manualmente, que darán prioridad a ciertos servidores sobre otros. 

El scheduler del módulo IPVS dispone de varios algoritmos para el reparto de carga, Aquí hablaré sobre los algoritmos más relevantes para este proyecto sin entrar en todo detalle sobre ellos, pero se puede ver en detalle información sobre todos los algoritmos disponibles, en las referencias citadas en [Fuentes](#62-ipvs) respecto a IPVS.

Además de encargarse de la distribución de paquetes, IPVS también mantiene cuenta de la cantidad de conexiones que hay en cada instante abiertas con cada nodo y esto será un dato de gran importancia, al ser uno de los factores que algunos algoritmos tienen en cuenta a la hora de realizar la distribución de paquetes.

El algoritmo que IPVS usará por defecto, en caso de no especificar nada, es WLC.

Cuanto mayor sea el peso asignado a un servidor, mayor será su prioridad y los algoritmos “Weighted” lo tendrán en cuenta para intentar priorizar la carga de paquetes a ese servidor, teniendo a los servidores con menor peso como fallback.
<a name="311-least-connections-lc"></a>
### 3.1.1. “Least Connections” (LC)
Es el algoritmo más básico de los algoritmos que tendrán en cuenta la cantidad de conexiones abiertas con cada nodo.
Este algoritmo enviará las peticiones a aquel nodo que tenga menos peticiones abiertas, permitiendo no saturar un nodo que ya tenga muchas conexiones.

<a name="312-weighted-least-connection-wlc"></a>
### 3.1.2. “Weighted Least-Connection” (WLC)
Este algoritmo es similar a Least Connections, pero añade el uso de pesos.
Esto supone que los paquetes serán redirigidos no a los nodos con menos conexiones, sino a los nodos de mayor peso que tengan menos conexiones.

<a name="313-round-robin-rr"></a>
### 3.1.3. “Round Robin” (RR)
Este algoritmo es el algoritmo más sencillo posible de distribución de carga.
Funciona iterando, hace un ciclo de forma ordenada en el que cada paquete es enviado al siguiente nodo, de forma que reparte la carga entre todos los nodos pero ignora la carga.

La mayor desventaja de este algoritmo respecto a LC es que si por algún motivo algún nodo tarda más en responder las peticiones, las conexiones activas a este nodos crecerán de forma desproporcionada con el resto de nodos, será un cluster no equilibrado.

<a name="314-weighted-round-robin-wrr"></a>
### 3.1.4. “Weighted Round Robin” (WRR)
Este algoritmo es similar a Round Robin pero tendrá en cuenta los pesos.
Los paquetes se distribuirán sin tener en cuenta la cantidad de conexiones pero la distribución no será equilibrada.

El algoritmo se encargará de que las peticiones sean enviadas en proporción a los pesos; Se le dará prioridad a los nodos con mayor peso, esto significa los nodos que tengan mayor peso serán los que reciban más peticiones.

Esto es util si el administrador sabe que uno de los nodos siempre responde más rápido, o que uno de los nodos es extremadamente lento, y podría ajustar los pesos para equilibrar la carga en función de ello.
<a name="33-alta-disponibilidad"></a>
## 3.3. Alta disponibilidad
Para ofrecer alta disponibilidad de los servicios web, usaré una herramienta llamada keepalived.

Esta herramienta se integra bien con LVS y se encargará de monitorear el estado del servicio web cada cierto tiempo en los nodos que esté gestionando.

Esta herramienta interactúa con la tabla de conexiones de IPVS al igual que hacía ipvsadm, pero en vez de actualizar la tabla manualmente ejecutando comandos, dinamicamente actualizará la tabla agregando y retirando de la misma los nodos configurados, en el momento que estén y dejen de estar disponibles.

Keepalived usa un archivo de configuración para obtener cuales son los nodos sobre los que tiene que hacer el check, la ip de cada nodo además de en qué puertos está el servicio, cual es el protocolo de este servicio (TCP en este caso, al ser tráfico HTTP), el protocolo de reparto de carga (se escoge round robin, en este caso no es necesario usar protocolos que tengan en cuenta cantidad de conexiones porque todas las peticiones supondrán la misma carga y todos los nodos tendrán los mismos recursos) y a qué dirección ip y puerto redirigir el tráfico.

Esta IP y puerto serán a donde apuntarán los clientes para conectarse al servicio web.


<a name="34-instalación-de-paquetes"></a>
## 3.4. Instalación de paquetes
Instalo los paquetes necesarios en el servidor master, una vez esté funcionando, desplegaré también en los nodos el servicio web, el despliegue será automatizado en los clientes agregados a la lista de Ips en un script, y se hará una réplica automática diaria usando scp y una tarea cron.

Los paquetes a instalar en el master serán: `ipvsadm`, `python3`, `keepalived`, `unzip`, `openssh-server`, `openssh-client`, `podman` y `podman-compose`.

Es posible que python3 ya esté instalado en algunas distribuciones.

Los nodos debian creados tendrán que tener `openssh-server` instalado y el servicio sshd habilitado e iniciado, además de un usuario accesible (usuario no root y con contraseña).

<a name="35-configuración-de-ipvs-en-master"></a>
## 3.5. Configuración de IPVS en master
<a name="351-configuración-de-ipv4-forwarding"></a>
### 3.5.1. Configuración de IPV4 forwarding
Es necesario habilitar IPV4 forwarding en master para que IPVS pueda enrutar el tráfico que recibe a los distintos nodos.

Esto se puede hacer creando un archivo .conf en /etc/sysctl.d y agregando la línea `net.ipv4.ip_forward = 1` o editando el archivo /etc/sysctl.conf y descomentando la línea.

Me aseguro que los cambios son efectivos ejecutando los siguientes comandos:

```
sysctl -p /etc/sysctl.conf
/etc/init.d/procps restart
```

<a name="352-comprobación-de-funcionamiento-de-IPVS"></a>
### 3.5.2. Comprobación de funcionamiento de IPVS
Usando ipvsadmin, comprobamos que IPVS funcionando, que el módulo está en el kernel, haciendo alguna prueba de funcionamiento

Crearé una entrada en la tabla de conexiones de IPVS indicando el modo de balanceo de carga; que será round robin, además de la dirección ip del servidor master y  un puerto arbitrario, ya que esto es solo para comprobar que funciona.

La ip es `192.168.100.1`, escojo el puerto `8000`.

`ipvsadm -A -t 192.168.100.1:8000 -s rr`

Si este comando funciona, se puede continuar, si no funciona es probable que el módulo de IPVS no haya sido cargado.

Eliminamos la entrada que acabamos de crear para la comprobación.

`ipvsadm -D -t 192.168.100.1:8000`

<a name="353-configuración-de-load-balancing-y-alta-disponibilidad"></a>
### 3.5.3. Configuración de Load Balancing y Alta Disponibilidad
Copio archivo `keepalived.conf` a `/etc/keepalived/keepalived.conf`

En el archivo se especifican las configuraciones que he hecho, en caso de estar usando otros puertos y/o direcciones ip, o querer usar otros algoritmos de balanceo de carga, ese sería el archivo en el que habría que configurarlo.

Inicio el servicio `keepalived.service`, dejándolo habilitado para que se inicie automáticamente en siguientes boots:

`systemctl enable –now keepalived`

<a name="#4-setup-de-base-de-datos-y-servicio-web"></a>
# 4. Setup de base de datos y servicio web
En el servidor master, creo el usuario www.
En `/etc/systemd/system`, agrego el archivo `surrealdb.service`

Usando el usuario www:
Agrego el archivo `server.ts` en `/home/www`

Instalo deno en el servidor:

```
curl -fsSL https://deno.land/install.sh | sh
curl -sSf https://install.surrealdb.com | sh
```

Agrego el archivo deno.service en el directorio /etc/systemd/system

Descargo una base de datos de ejemplo de surrealdb y la importo:

```
wget https://datasets.surrealdb.com/surreal-deal-store.surql
/home/www/.surrealdb/surreal import --conn http://192.168.100.1:8081 --user root --pass root --ns test --db test surreal-deal-store.surql
```

Inicio y habilito los servicios, de forma que se ejecuten automáticamente después de terminar el boot, está configurado para que se reinicie on-failure:

```
systemctl enable –now surrealdb
systemctl enable –now deno
```

Agrego server.ts a los nodos en /home/www/server.ts usando scp y el usuario www.

Ejecuto en los nodos el comando de instalación de deno, conectándome por ssh desde el servidor master, usando el usuario www.

Con root, agrego a los nodos el archivo deno.service en el directorio /etc/systemd/system

<a name="5-mejoras"></a>
# 5. Mejoras
<a name="51-despliegues-automatizados-y-sincronización-de-nodos"></a>
# 5.1. Despliegues automatizados y sincronización de nodos
Los nodos han sido creados con un usuario root y un usuario www con una contraseña por defecto, no solo para la administración manual de estos nodos sino para que el servidor master se pueda conectar con estos por ssh de forma automatizada para realizar tareas.

La mejora sería crear un script que despliegue en todos los nodos el servidor deno, y que mantenga los nodos sincronizados de forma que si en master hago un cambio del servicio web, este cambio se propague a todos los nodos.

<a name="6-fuentes"></a>
# 6. Fuentes
<a name="61-linux-virtual-server"></a>
## 6.1. Linux Virtual Server
http://www.linuxvirtualserver.org/

http://kb.linuxvirtualserver.org/wiki/Load_balancer

http://kb.linuxvirtualserver.org/wiki/Load_balancing

http://www.linuxvirtualserver.org/whatis.html

<a name="62-ipvs"></a>
## 6.2. IPVS
http://www.linuxvirtualserver.org/software/ipvs.html 

https://man.archlinux.org/man/ipvsadm.8.en

https://docs.redhat.com/es/documentation/red_hat_enterprise_linux/5/html/virtual_server_administration/ch-lvs-overview-vsa

<a name="63-keepalived"></a>
## 6.3. Keepalived
https://www.keepalived.org/

https://www.keepalived.org/manpage.html

https://wiki.archlinux.org/title/Keepalived

https://www.redhat.com/en/blog/keepalived-basics

<a name="64-deno"></a>
## 6.4. Deno
https://docs.deno.com/

https://docs.deno.com/runtime/

https://docs.deno.com/runtime/getting_started/command_line_interface/

https://docs.deno.com/runtime/fundamentals/http_server/

<a name="65-surrealdb"></a>
## 6.5. SurrealDB
https://surrealdb.com/docs/surrealdb/installation/linux

https://surrealdb.com/docs/surrealdb/cli/start

https://surrealdb.com/docs/surrealdb/cli/sql

https://surrealdb.com/docs/surrealql/datamodel
